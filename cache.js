import _ from 'lodash'
import migrate from './autoMigrate.js'

let settings = {
  autoMigrate:false
}

export default settings

function flattenFields(object, prefix){
  prefix = prefix || ''
  let fields = []
  _.each(object, (val, key) => {
    if(typeof val == 'object'){
      fields = _.union(fields, flattenFields(val, prefix + key + '.'))
    } else {
      fields.push(prefix + key)
    }
  })
  return fields
}

Mongo.Collection.prototype.cache = function(options){
  check(options, {
    collection:Match.Where(collection => collection instanceof Mongo.Collection),
    fields:Match.OneOf([String], Object),
    type:Match.OneOf('one', 'many', 'inversed', 'inverse', 'many-inversed', 'many-inverse'),
    referenceField:String,
    cacheField:String,
    bypassSchema:Match.Optional(Boolean)
  })
  if(options.type == 'inverse') options.type = 'inversed' //Not sure which is best, so why not support both and be typo-friendly
  if(options.type == 'many-inverse') options.type = 'many-inversed'

  //Bypass collection2 schemas
  let parentCollection = options.bypassSchema && Package['aldeed:collection2'] ? this._collection : this
  let childCollection = options.collection
  let type = options.type
  let referenceField = options.referenceField
  let cacheField = options.cacheField
  let watchedFields = options.fields

  if(!_.isArray(watchedFields)){
    watchedFields = flattenFields(watchedFields)
  }

  let childFields = _.clone(watchedFields)
  if(type !== 'one'){
    if(!_.includes(childFields, '_id')){
      childFields.push('_id')
    }
    _.pull(childFields, referenceField)
  }
  let childOpts = {transform:null, fields:{_id:0}}
  _.each(childFields, field => childOpts.fields[field] = 1)

  let parentOpts = {transform:null, fields:{_id:1, [cacheField]:1}}
  if(type !== 'inversed' && type !== 'many-inversed'){
    parentOpts.fields[referenceField.split(':')[0]] = 1
  }

  let idField, referencePath
  if(type == 'many' || type == 'many-inversed'){
    referencePath = referenceField.replace(':', '.')
    idField = referenceField.split(':')[1]
    referenceField = referenceField.split(':')[0]
  }

  if(type == 'inversed' || type == 'many-inversed' && !_.includes(watchedFields, referencePath)){
    watchedFields.push(referencePath || referenceField)
  }

  let topFields = _.uniq(watchedFields.map(field => field.split('.')[0]))

  function getNestedReferences(document){ //Used for nested references in "many" links
    let references = _.get(document, referenceField) || []
    if(idField && references.length){
      references = _.map(references, item => _.get(item, idField))
    }
    return _.uniq(_.flatten(references))
  }

  function oneInsert(userId, parent){
    if(_.get(parent, referenceField)){
      let child = childCollection.findOne(_.get(parent, referenceField), childOpts)
      if(child){
        parentCollection.update(parent._id, {$set:{[cacheField]:child}})
      }
    }
  }

  if(type == 'one'){
    migrate(parentCollection, oneInsert, options)    

    parentCollection.after.insert(oneInsert)

    parentCollection.after.update(function(userId, parent, changedFields){
      if(_.includes(changedFields, referenceField.split('.')[0])){
        let child = _.get(parent, referenceField) && childCollection.findOne(_.get(parent, referenceField), childOpts)
        if(child){
          parentCollection.update(parent._id, {$set:{[cacheField]:child}})
        } else {
          parentCollection.update(parent._id, {$unset:{[cacheField]:1}})
        }
      }
    })

    childCollection.after.insert(function(userId, child){
      let pickedChild = _.pick(child, childFields)
      parentCollection.update({[referenceField]:child._id}, {$set:{[cacheField]:pickedChild}}, {multi:true})
    })

    childCollection.after.update(function(userId, child, changedFields){
      if(_.intersection(changedFields, topFields).length){
        let pickedChild = _.pick(child, childFields)
        parentCollection.update({[referenceField]:child._id}, {$set:{[cacheField]:pickedChild}}, {multi:true})
      }
    })

    childCollection.after.remove(function(userId, child){
      parentCollection.update({[referenceField]:child._id}, {$unset:{[cacheField]:1}}, {multi:true})
    })

    return
  } 

  function manyInsert(userId, parent){
    let references = getNestedReferences(parent)
    if(references.length){
      let children = childCollection.find({_id:{$in:references}}, childOpts).fetch()
      parentCollection.update(parent._id, {$set:{[cacheField]:children}})
    } else {
      parentCollection.update(parent._id, {$set:{[cacheField]:[]}})
    }
  }

  if(type == 'many'){
    migrate(parentCollection, manyInsert, options)

    parentCollection.after.insert(manyInsert)

    parentCollection.after.update(function(userId, parent, changedFields){
      if(_.includes(changedFields, referencePath.split('.')[0])){
        let references = getNestedReferences(parent)
        if(references.length){
          let children = childCollection.find({_id:{$in:references}}, childOpts).fetch()
          parentCollection.update(parent._id, {$set:{[cacheField]:children}})
        } else {
          parentCollection.update(parent._id, {$set:{[cacheField]:[]}})
        }
      }
    })

    childCollection.after.insert(function(userId, child){
      let pickedChild = _.pick(child, childFields)
      let parent = parentCollection.find({[referencePath]:child._id}).forEach(parent => {
        if(!_.find(parent[cacheField], {_id:child._id})){
          parentCollection.update(parent._id, {$push:{[cacheField]:pickedChild}})
        }
      })
    })

    childCollection.after.update(function(userId, child, changedFields){
      if(_.intersection(changedFields, topFields).length){
        let pickedChild = _.pick(child, childFields)
        parentCollection.find({[referencePath]:child._id}, parentOpts).forEach(parent => {
          let index = _.findIndex(_.get(parent, cacheField), {_id:child._id})
          if(index > -1){
            parentCollection.update(parent._id, {$set:{[cacheField + '.' + index]:pickedChild}})
          } else {
            parentCollection.update(parent._id, {$push:{[cacheField]:pickedChild}})
          }
        })
      }
    })

    childCollection.after.remove(function(userId, child){
      parentCollection.update({[referencePath]:child._id}, {$pull:{[cacheField]:{_id:child._id}}}, {multi:true})
    })

    return
  }

  function inversedInsert(userId, parent){
    let children = childCollection.find({[referenceField]:parent._id}, childOpts).fetch()
    parentCollection.update(parent._id, {$set:{[cacheField]:children}})
  }

  if(type == 'inversed'){
    migrate(parentCollection, inversedInsert, options)

    parentCollection.after.insert(inversedInsert)

    parentCollection.after.update(function(userId, parent, changedFields){
      if(_.includes(changedFields, referenceField.split('.')[0])){
        if(_.get(parent, referenceField)){
          let children = childCollection.find({[referenceField]:parent._id}, childOpts).fetch()
          parentCollection.update(parent._id, {$set:{[cacheField]:children}})
        } else {
          parentCollection.update(parent._id, {$set:{[cacheField]:[]}})
        }
      }
    })

    childCollection.after.insert(function(userId, child){
      let pickedChild = _.pick(child, childFields)
      if(_.get(child, referenceField)){
        //This is pretty weird: sometimes "update" can trigger before "insert", so we need to check if the child has already been cached
        let parent = parentCollection.findOne(_.get(child, referenceField), {fields:{[cacheField]:1}})
        if(!_.find(parent[cacheField], {_id:child._id})){
          parentCollection.update(parent._id, {$push:{[cacheField]:pickedChild}})
        }
      }
    })

    childCollection.after.update(function(userId, child, changedFields){
      if(cacheField == '_bills2'){
        console.log('UPDATE', child._amount)
      }
      if(_.intersection(changedFields, topFields).length){
        if(cacheField == '_bills2'){
          console.log('Intersection', child._amount)
        }
        let pickedChild = _.pick(child, childFields)
        let previousId = this.previous && _.get(this.previous, referenceField)
        if(previousId && previousId !== _.get(child, referenceField)){
          parentCollection.update({_id:previousId}, {$pull:{[cacheField]:{_id:child._id}}})
        }
        parentCollection.find({_id:_.get(child, referenceField)}, parentOpts).forEach(parent => {
          let index = _.findIndex(_.get(parent, cacheField), {_id:child._id})
          if(index > -1){
            if(cacheField == '_bills2'){
              console.log('exists...', child._amount)
            }
            parentCollection.update(parent._id, {$set:{[cacheField + '.' + index]:pickedChild}})
          } else {
            parentCollection.update(parent._id, {$push:{[cacheField]:pickedChild}})
          }
        })
      }
    })

    childCollection.after.remove(function(userId, child){
      parentCollection.update({_id:_.get(child, referenceField)}, {$pull:{[cacheField]:{_id:child._id}}})
    })

    return
  }

  function manyInversedInsert(userId, parent){
    let children = childCollection.find({[referencePath]:parent._id}, childOpts).fetch()
    parentCollection.update(parent._id, {$set:{[cacheField]:children}})
  }

  if(type == 'many-inversed'){
    migrate(parentCollection, manyInversedInsert, options)

    parentCollection.after.insert(manyInversedInsert)

    parentCollection.after.update(function(userId, parent, changedFields){
      if(_.includes(changedFields, referencePath.split('.')[0])){
        let children = childCollection.find({[referencePath]:parent._id}, childOpts).fetch()
        parentCollection.update(parent._id, {$set:{[cacheField]:children}})
      }
    })

    childCollection.after.insert(function(userId, child){
      let references = getNestedReferences(child)
      if(references.length){
        let pickedChild = _.pick(child, childFields)
        parentCollection.find({_id:{$in:references}}, parentOpts).forEach(parent => {
          if(!_.find(parent[cacheField], {_id:child._id})){ //Pretty weird but necessary. Sometimes "update" can trigger before "insert"
            parentCollection.update(parent._id, {$push:{[cacheField]:pickedChild}})
          }
        })
      }
    })

    childCollection.after.update(function(userId, child, changedFields){
      if(_.intersection(changedFields, topFields).length){
        let references = getNestedReferences(child)
        let previousIds = this.previous && getNestedReferences(this.previous)
        previousIds = _.difference(previousIds, references)
        if(previousIds.length){
          parentCollection.update({_id:{$in:previousIds}}, {$pull:{[cacheField]:{_id:child._id}}}, {multi:true})
        }
        if(references.length){
          let pickedChild = _.pick(child, childFields)
          parentCollection.find({_id:{$in:references}}, parentOpts).forEach(parent => {
            let index = _.findIndex(_.get(parent, cacheField), {_id:child._id})
            if(index > -1){
              parentCollection.update(parent._id, {$set:{[cacheField + '.' + index]:pickedChild}})
            } else {
              parentCollection.update(parent._id, {$push:{[cacheField]:pickedChild}})
            }
          })
        }
      }
    })

    childCollection.after.remove(function(userId, child){
      let references = getNestedReferences(child)
      if(references.length){
        parentCollection.update({_id:{$in:references}}, {$pull:{[cacheField]:{_id:child._id}}}, {multi:true})
      }
    })
  }
}