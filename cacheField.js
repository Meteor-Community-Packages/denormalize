import _ from 'lodash'
import {addMigration} from './migrations.js'

Mongo.Collection.prototype.cacheField = function(options) {

  check(options, {
    cacheField:String,
    fields:[String],
    transform:Match.Optional(Function),
    bypassSchema:Match.Optional(Boolean)
  })

  let collection = options.bypassSchema && Package['aldeed:collection2'] ? this._collection : this
  let cacheField = options.cacheField
  let fields = options.fields
  let topFields = _.uniq(_.map(fields, field => field.split('.')[0]))
  let transform = options.transform
  if(!transform) {
    transform = function(doc) {
      return _.compact(_.map(fields, field => _.get(doc, field))).join(', ')
    }
  }

  if(_.includes(topFields, cacheField.split(/[.:]/)[0])){
    throw new Error('watching the cacheField for changes would cause an infinite loop')
  }

  function insertHook(userid, doc){
    collection.update(doc._id, {$set:{[cacheField]:transform(_.pick(doc, fields))}})
  }

  addMigration(collection, insertHook, options)

  collection.after.insert(insertHook)

  collection.after.update(function (userId, doc, changedFields) {
    if(_.intersection(changedFields, topFields).length){
      Meteor.defer(Meteor.bindEnvironment(function () {
        collection.update(doc._id, {$set:{[cacheField]:transform(_.pick(doc, fields))}})
      }))
    }
  })  
}
