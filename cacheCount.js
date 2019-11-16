import _ from 'lodash'
import {addMigration} from './migrations.js'

Mongo.Collection.prototype.cacheCount = function(options) {
  check(options, {
    collection:Mongo.Collection,
    cacheField:String,
    referenceField:String,
    selector:Match.Optional(Object),
    updateOptions:Match.Optional(Object)
  })

  let parentCollection = this
  let childCollection = options.collection
  let selector = options.selector || {}
  let cacheField = options.cacheField
  let referenceField = options.referenceField
  let watchedFields = _.union([referenceField], _.keys(selector))

  if(referenceField.split(/[.:]/)[0] == cacheField.split(/[.:]/)[0]){
    throw new Error('referenceField and cacheField must not share the same top field')
  }

  function update(child){
    let ref = _.get(child, referenceField)
    if(ref){
      let select = _.merge(selector, {[referenceField]:ref})
      parentCollection.update({_id:ref}, {$set:{[cacheField]:childCollection.find(select).count()}}, options.updateOptions)
    }
  }

  function insert(userId, parent){
    let select = _.merge(selector, {[referenceField]:parent._id})
    parentCollection.update(parent._id, {$set:{[cacheField]:childCollection.find(select).count()}}, options.updateOptions)
  }

  addMigration(parentCollection, insert, options)

  parentCollection.after.insert(insert)
  
  childCollection.after.insert((userId, child) => {
    update(child)
  })

  childCollection.after.update((userId, child, changedFields) => {
    if(_.intersection(changedFields, watchedFields).length){
      update(child)
      update(this.previous)
    }
  })

  childCollection.after.remove((userId, child) => {
    update(child)
  })
}