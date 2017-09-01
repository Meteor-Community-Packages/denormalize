import _ from 'lodash'
import {Mongo} from 'meteor/mongo'
import settings from './cache.js'

export const Migrations = new Mongo.Collection('_cacheMigrations')

//Running the insert hook on each document in the collection should always be enough to "migrate" them
export default function migrate(collection, insertFn, options){
  if(!settings.autoMigrate){
    return
  }
  //We use the options to see if this migration has been done before
  let opts = _.cloneDeep(options)
  if(opts.collection){ //prevent Error: Converting circular structure to JSON
    opts.collection = opts.collection._name
  }
  opts = JSON.stringify(opts)
  
  if(!Migrations.findOne({collection:collection._name, options:opts})){
    //If the migration has not been done before, run it and add it to the collection
    let time = new Date()
    collection.find().forEach(doc => {
      insertFn(null, doc)
    })
    Migrations.insert({
      collection:collection._name,
      options:opts,
      date:new Date(),
      timeTaken:time - new Date()
    })
  }
}