import {Mongo} from 'meteor/mongo'
import _ from 'lodash'
const chai = require('chai');
const assert = chai.assert;

import {MigrationHistory, migrate, autoMigrate} from './migrations.js'
function report(result, expected, path = ''){
  let keys = _.union(_.keys(result), _.keys(expected))
  _.each(keys, key => {
    if(!_.isEqual(result[key], expected[key])){
      console.log('MISMATCH:', key)
      console.log('Expected:', JSON.stringify(expected[key], null, ' '))
      console.log('     Got:', JSON.stringify(result[key], null, ' '))
    }
  })
}
function compare(result, expected){
  try{
    assert.deepEqual(result, expected)
  } catch(err){
    report(result, expected)
    throw err
  }  
}


Posts = new Mongo.Collection('posts') //parent
Comments = new Mongo.Collection('comments') //inversed
Users = new Mongo.Collection('users') //single
Images = new Mongo.Collection('images') //many
Tags = new Mongo.Collection('tags') //many-inversed
Likes = new Mongo.Collection('likes') // count
Customers = new Mongo.Collection('customers') //recursive caches
Bills = new Mongo.Collection('bills') //recursive caches
Items = new Mongo.Collection('items') //recursive caches



describe('setup', function(){
  it('clear collections', function(){
    Posts.remove({})
    Comments.remove({})
    Users.remove({})
    Images.remove({})
    Tags.remove({})
    Likes.remove({})
    MigrationHistory.remove({})
  })
  it('clear hooks', function(){
    //Remove all collection hooks so that migration tests work properly
    _.each([Posts, Comments, Users, Images, Tags, Likes], collection => {
      collection._hookAspects.insert.after = []
      collection._hookAspects.update.after = []
      collection._hookAspects.remove.after = []
    })
  })
  it('insert migrants', function(){
    //These users inserted before the caches have been declared, so they will need to be migrated
    Users.insert({
      _id:'migrant1',
      username:'Simon',
      profile:{
        first_name:'Simon',
        last_name:'Herteby'
      }
    })
    Users.insert({
      _id:'migrant2',
      username:'bill_gates@microsoft.com',
      profile:{
        first_name:'Bill',
        last_name:'Gates'
      }
    })
    Users.insert({
      _id:'migrant3',
      username:'steve_jobs@apple.com',
      profile:{
        first_name:'Steve',
        last_name:'Jobs'
      }
    })
  })
  it('Set up caches', function(){
    Posts.cache({
      type:'one',
      collection:Users,
      cacheField:'_author',
      referenceField:'authorId',
      fields:{
        username:1, 
        profile:{
          first_name:1,
          last_name:1
        }
      },
    })
    Posts.cache({
      type:'inversed',
      collection:Comments,
      cacheField:'_comments',
      referenceField:'postId',
      fields:{message:1},
    })
    Posts.cache({
      type:'many',
      collection:Images,
      cacheField:'_images',
      referenceField:'imageIds',
      fields:{filename:1}
    })
    Posts.cache({
      type:'many-inversed',
      collection:Tags,
      cacheField:'_tags',
      referenceField:'postIds',
      fields:{name:1}
    })
    Posts.cacheCount({
      collection:Likes,
      cacheField:'_likes.all',
      referenceField:'postId'
    })
    Posts.cacheCount({
      collection:Likes,
      cacheField:'_likes.sweden',
      referenceField:'postId',
      selector:{country:'Sweden'}
    })
    Users.cacheField({
      cacheField:'_defaultTransform',
      fields:['username', 'profile.first_name', 'profile.last_name']
    })
    Users.cacheField({
      cacheField:'nested._customTransform',
      fields:['username', 'profile.first_name', 'profile.last_name'],
      transform(doc){
        return [doc.username, _.get(doc, 'profile.first_name'), _.get(doc, 'profile.last_name')]
      }
    })
  })
})

describe('Migration', function(){
  describe('migrate()', function(){
    it('user should not have cache before migration', function(){
      let migrant1 = Users.findOne('migrant1')
      compare(migrant1, {
        _id:'migrant1',
        username:'Simon',
        profile:{
          first_name:'Simon',
          last_name:'Herteby'
        }
      })      
    })
    it('migrated document should have the correct caches', function(){
      migrate('users', '_defaultTransform', 'migrant1')
      migrate('users', 'nested._customTransform', {_id:'migrant1'})
      let migrant1 = Users.findOne('migrant1')
      compare(migrant1, {
        _id:'migrant1',
        username:'Simon',
        profile:{
          first_name:'Simon',
          last_name:'Herteby'
        },
        _defaultTransform:'Simon, Simon, Herteby',
        nested:{_customTransform:['Simon', 'Simon', 'Herteby']}
      })
    })
    it('documents not matching selector should not have caches', function(){
      let migrant2 = Users.findOne('migrant2')
      let migrant3 = Users.findOne('migrant3')
      compare(migrant2, {
        _id:'migrant2',
        username:'bill_gates@microsoft.com',
        profile:{
          first_name:'Bill',
          last_name:'Gates'
        }
      })
      compare(migrant3, {
        _id:'migrant3',
        username:'steve_jobs@apple.com',
        profile:{
          first_name:'Steve',
          last_name:'Jobs'
        }
      })   
    })
  })
  describe('autoMigrate()', function(){
    it('migrated documents should have the correct caches', function(){
      autoMigrate()
      console.log("(Don't worry about the console log saying 'migrated 0 docs' a bunch of times. That is correct.)")
      let migrant2 = Users.findOne('migrant2')
      let migrant3 = Users.findOne('migrant3')
      compare(migrant2, {
        _id:'migrant2',
        username:'bill_gates@microsoft.com',
        profile:{
          first_name:'Bill',
          last_name:'Gates'
        },
        _defaultTransform:'bill_gates@microsoft.com, Bill, Gates',
        nested:{_customTransform:['bill_gates@microsoft.com', 'Bill', 'Gates']}
      })
      compare(migrant3, {
        _id:'migrant3',
        username:'steve_jobs@apple.com',
        profile:{
          first_name:'Steve',
          last_name:'Jobs'
        },
        _defaultTransform:'steve_jobs@apple.com, Steve, Jobs',
        nested:{_customTransform:['steve_jobs@apple.com', 'Steve', 'Jobs']}
      })
    })
  })
})

describe('Insert parent - no children', function(){
  it('one cache should not exist', function(){
    Posts.insert({
      _id:'post1',
      authorId:'user1',
      imageIds:['dog', 'cat']
    })
    assert.isUndefined(Posts.findOne('post1')._author)
  })
  it('many cache should be empty array', function(){
    assert.isArray(Posts.findOne('post1')._images)
    assert.strictEqual(Posts.findOne('post1')._images.length, 0)
  })
  it('inversed cache should be empty array', function(){
    assert.isArray(Posts.findOne('post1')._comments)
    assert.strictEqual(Posts.findOne('post1')._comments.length, 0)
  })
  it('many-inversed cache should be empty array', function(){
    assert.isArray(Posts.findOne('post1')._tags)
    assert.strictEqual(Posts.findOne('post1')._tags.length, 0)
  })
  it('unfiltered count should be 0', function(){
    assert.strictEqual(Posts.findOne('post1')._likes.all, 0)
  })
  it('filtered count should be 0', function(){
    assert.strictEqual(Posts.findOne('post1')._likes.sweden, 0)
  })
})
describe('Type: one', function(){
  describe('Insert child', function(){
    it('child should be deeply equal except _id', function(){
      Users.insert({
        _id:'user1',
        username:'Simon',
        profile:{
          first_name:'Simon',
          last_name:'Herteby'
        }
      })
      let post = Posts.findOne('post1')
      let user = Users.findOne('user1', {fields:{_id:0, username:1, profile:1}})
      compare(post._author, user)
    })
  })
  describe('Update child', function(){
    it('cache should have the new values', function(){
      Users.update('user1', {$set:{'profile.last_name':'Svensson'}})
      let post = Posts.findOne('post1')
      let user = Users.findOne('user1', {fields:{_id:0, username:1, profile:1}})
      compare(post._author, user)
    })
  })
  
  describe('Update parent referenceField', function(){
    it('cache should reflect the new child', function(){
      Users.insert({
        _id:'user2',
        username:'Karl',
        profile:{
          first_name:'Karl',
          last_name:'Henriksson'
        }
      })
      Posts.update('post1', {$set:{authorId:'user2'}})
      let post = Posts.findOne('post1')
      let user = Users.findOne('user2', {fields:{_id:0, username:1, profile:1}})
      compare(post._author, user)
    })
  })
  describe('Remove child', function(){
    it('cache should be undefined', function(){
      Users.remove('user2')
      let post = Posts.findOne('post1')
      assert.isUndefined(post._author)
    })
  })
  describe('Insert another parent', function(){ 
    it('new parent should have child in cache', function(){
      Posts.insert({
        _id:'post2',
        authorId:'user1'
      })
      let post = Posts.findOne('post2')
      let user = Users.findOne('user1', {fields:{_id:0, username:1, profile:1}})
      compare(post._author, user)
    })
  })
})


describe('Type: many', function(){
  describe('Insert child', function(){
    it('cache should contain child', function(){
      Images.insert({
        _id:'cat',
        filename:'cat.jpg'
      })
      let post = Posts.findOne('post1')
      let image = Images.findOne('cat')
      compare(post._images, [image])
    })
  })
  describe('Insert another child', function(){
    it('cache should contain both children', function(){
      Images.insert({
        _id:'dog',
        filename:'dog.png'
      })
      let post = Posts.findOne('post1')
      let cat = Images.findOne('cat')
      let dog = Images.findOne('dog')
      compare(post._images, [cat, dog])
    })
  })
  describe('Update children', function(){
    it('cache should contain both updated children', function(){
      Images.find().forEach(image => {
        Images.update(image._id, {$set:{filename:image.filename + '.zip'}})
      })
      let post = Posts.findOne('post1')
      let cat = Images.findOne('cat')
      let dog = Images.findOne('dog')
      compare(post._images, [cat, dog])
    })
  })
  describe('Remove child', function(){
    it('cache should only contain the remaining child', function(){
      Images.remove('cat')
      let post = Posts.findOne('post1')
      let dog = Images.findOne('dog')
      compare(post._images, [dog])
    })
  })
  describe('Insert unlinked child', function(){
    it('cache should not contain the inserted child', function(){
      Images.insert({
        _id:'horse',
        filename:'horse.gif'
      })
      let post = Posts.findOne('post1')
      let dog = Images.findOne('dog')
      compare(post._images, [dog])
    })
  })
  describe('Add child to parent referenceField', function(){
    it('cache should contain both children', function(){
      Posts.update('post1', {$push:{imageIds:'horse'}})
      let post = Posts.findOne('post1')
      let horse = Images.findOne('horse')
      let dog = Images.findOne('dog')
      compare(post._images, [dog, horse])
    })
  })
  describe('Remove child from parent referenceField', function(){
    it('cache should only contain remaining child', function(){
      Posts.update('post1', {$pull:{imageIds:'dog'}})
      let post = Posts.findOne('post1')
      let horse = Images.findOne('horse')
      compare(post._images, [horse])
    })
  })
  describe('Insert another parent', function(){
    it('cache should have correct children', function(){
      Posts.insert({
        _id:'post3',
        imageIds:['dog', 'horse']
      })
      let post = Posts.findOne('post3')
      let dog = Images.findOne('dog')
      let horse = Images.findOne('horse')
      compare(post._images, [dog, horse])
    })
  })
})


describe('Type: inversed', function(){
  describe('Insert child', function(){
    it('cache should contain child', function(){
      Comments.insert({
        _id:'comment1',
        message:'Hello world!',
        postId:'post1'
      })
      let post = Posts.findOne('post1')
      let comment = Comments.findOne('comment1', {fields:{postId:0}})
      compare(post._comments, [comment])
    })
  })
  describe('Insert another child', function(){
    it('cache should contain both children', function(){
      Comments.insert({
        _id:'comment2',
        message:'Hello world!',
        postId:'post1'
      })
      let post = Posts.findOne('post1')
      let comment1 = Comments.findOne('comment1', {fields:{postId:0}})
      let comment2 = Comments.findOne('comment2', {fields:{postId:0}})
      compare(post._comments, [comment1, comment2])
    })
  })
  describe('Insert unlinked child', function(){
    it('cache should not contain new child', function(){
      Comments.insert({
        _id:'comment3',
        message:'Hello world again!',
      })
      let post = Posts.findOne('post1')
      let comment1 = Comments.findOne('comment1', {fields:{postId:0}})
      let comment2 = Comments.findOne('comment2', {fields:{postId:0}})
      compare(post._comments, [comment1, comment2])
    })
  })
  describe('Update child referenceField', function(){
    it('cache should contain new and previous children', function(){
      Comments.update('comment3', {$set:{postId:'post1'}})
      let post = Posts.findOne('post1')
      let comment1 = Comments.findOne('comment1', {fields:{postId:0}})
      let comment2 = Comments.findOne('comment2', {fields:{postId:0}})
      let comment3 = Comments.findOne('comment3', {fields:{postId:0}})
      compare(post._comments, [comment1, comment2, comment3])
    })
  })
  describe('Update children', function(){
    it('cache should contain updated children', function(){
      Comments.update({}, {$set:{message:'Goodbye world!'}}, {multi:true})
      let post = Posts.findOne('post1')
      let comment1 = Comments.findOne('comment1', {fields:{postId:0}})
      let comment2 = Comments.findOne('comment2', {fields:{postId:0}})
      let comment3 = Comments.findOne('comment3', {fields:{postId:0}})
      compare(post._comments, [comment1, comment2, comment3])
    })
  })
  describe('Remove child', function(){
    it('cache should only contain remaining children', function(){
      Comments.remove('comment2')
      let post = Posts.findOne('post1')
      let comment1 = Comments.findOne('comment1', {fields:{postId:0}})
      let comment3 = Comments.findOne('comment3', {fields:{postId:0}})
      compare(post._comments, [comment1, comment3])
    })
  })
  describe('Remove parent from child referenceField', function(){
    it('cache should only contain remaining child', function(){
      Comments.update('comment3', {$unset:{postId:1}})
      let post = Posts.findOne('post1')
      let comment1 = Comments.findOne('comment1', {fields:{postId:0}})
      compare(post._comments, [comment1])
    })
  })
  describe('Insert another parent', function(){
    it('cache should contain all children', function(){
      Comments.update({}, {$set:{postId:'post4'}}, {multi:true})
      Posts.insert({
        _id:'post4'
      })
      let post = Posts.findOne('post4')
      let comments = Comments.find({}, {fields:{postId:0}}).fetch()
      compare(post._comments, comments)
    })
  })
})


describe('Type: many-inversed', function(){
  describe('Insert child', function(){
    it('parent1 should contain child', function(){
      Tags.insert({
        _id:'tag1',
        name:'Red',
        postIds:['post1', 'post2']
      })
      let post1 = Posts.findOne('post1')
      let tag = Tags.findOne('tag1', {fields:{postIds:0}})
      compare(post1._tags, [tag])
    })
    it('parent2 should contain child', function(){
      let post2 = Posts.findOne('post2')
      let tag = Tags.findOne('tag1', {fields:{postIds:0}})
      compare(post2._tags, [tag])
    })
    it('parent3 should not contain child', function(){
      let post3 = Posts.findOne('post3')
      compare(post3._tags, [])
    })
  })
  describe('Insert another child', function(){
    it('parent1 should contain both children', function(){
      Tags.insert({
        _id:'tag2',
        name:'Blue',
        postIds:['post1', 'post2']
      })
      let post1 = Posts.findOne('post1')
      let tag1 = Tags.findOne('tag1', {fields:{postIds:0}})
      let tag2 = Tags.findOne('tag2', {fields:{postIds:0}})
      compare(post1._tags, [tag1, tag2])
    })
    it('parent2 should contain both children', function(){
      let post2 = Posts.findOne('post1')
      let tag1 = Tags.findOne('tag1', {fields:{postIds:0}})
      let tag2 = Tags.findOne('tag2', {fields:{postIds:0}})
      compare(post2._tags, [tag1, tag2])
    })
  })
  describe('Insert unlinked child', function(){
    it('cache should not contain new child', function(){
      Tags.insert({
        _id:'tag3',
        name:'Green'
      })
      let post = Posts.findOne('post1')
      let tag1 = Tags.findOne('tag1', {fields:{postIds:0}})
      let tag2 = Tags.findOne('tag2', {fields:{postIds:0}})
      compare(post._tags, [tag1, tag2])
    })
  })
  describe('Update child referenceField', function(){
    it('parent1 should now contain the child', function(){
      Tags.update('tag3', {$set:{'postIds':['post1', 'post2']}})
      let post1 = Posts.findOne('post1')
      let tag1 = Tags.findOne('tag1', {fields:{postIds:0}})
      let tag2 = Tags.findOne('tag2', {fields:{postIds:0}})
      let tag3 = Tags.findOne('tag3', {fields:{postIds:0}})
      compare(post1._tags, [tag1, tag2, tag3])
    })
    it('parent2 should now contain the child', function(){
      let post2 = Posts.findOne('post2')
      let tag1 = Tags.findOne('tag1', {fields:{postIds:0}})
      let tag2 = Tags.findOne('tag2', {fields:{postIds:0}})
      let tag3 = Tags.findOne('tag3', {fields:{postIds:0}})
      compare(post2._tags, [tag1, tag2, tag3])
    })
  })
  describe('Update child referenceField', function(){
    it('parent1 should contain updated children', function(){
      Tags.find().forEach(tag => {
        Tags.update(tag._id, {$set:{name:'color-' + tag.name}})
      })
      let post1 = Posts.findOne('post1')
      let tag1 = Tags.findOne('tag1', {fields:{postIds:0}})
      let tag2 = Tags.findOne('tag2', {fields:{postIds:0}})
      let tag3 = Tags.findOne('tag3', {fields:{postIds:0}})
      compare(post1._tags, [tag1, tag2, tag3])
    })
    it('parent2 should contain updated children', function(){
      let post2 = Posts.findOne('post2')
      let tag1 = Tags.findOne('tag1', {fields:{postIds:0}})
      let tag2 = Tags.findOne('tag2', {fields:{postIds:0}})
      let tag3 = Tags.findOne('tag3', {fields:{postIds:0}})
      compare(post2._tags, [tag1, tag2, tag3])
    })
  })
  describe('Remove child', function(){
    it('parent1 should only contain remaining children', function(){
      Tags.remove('tag1')
      let post1 = Posts.findOne('post1')
      let tag2 = Tags.findOne('tag2', {fields:{postIds:0}})
      let tag3 = Tags.findOne('tag3', {fields:{postIds:0}})
      compare(post1._tags, [tag2, tag3])
    })
    it('parent2 should only contain remaining children', function(){
      let post2 = Posts.findOne('post2')
      let tag2 = Tags.findOne('tag2', {fields:{postIds:0}})
      let tag3 = Tags.findOne('tag3', {fields:{postIds:0}})
      compare(post2._tags, [tag2, tag3])
    })
  })
  describe('Remove parent2 from child referenceField', function(){
    it('parent1 should still contain child', function(){
      Tags.update('tag3', {$pull:{postIds:'post2'}})
      let post1 = Posts.findOne('post1')
      let tag2 = Tags.findOne('tag2', {fields:{postIds:0}})
      let tag3 = Tags.findOne('tag3', {fields:{postIds:0}})
      compare(post1._tags, [tag2, tag3])
    })
    it('parent2 should not contain child', function(){
      let post2 = Posts.findOne('post2')
      let tag2 = Tags.findOne('tag2', {fields:{postIds:0}})
      compare(post2._tags, [tag2])
    })
  })
  describe('Insert another parent', function(){
    it('new parent should contain all children', function(){
      Tags.update({}, {$push:{postIds:'post5'}}, {multi:true})
      Posts.insert({
        _id:'post5'
      })
      let post = Posts.findOne('post5')
      let tags = Tags.find({}, {fields:{postIds:0}}).fetch()
      compare(post._tags, tags)
    })
  })
})

describe('cacheCount', function(){
  describe('Insert child matching filter', function(){
    it('unfiltered count should be 1', function(){
      Likes.insert({
        _id:'like1',
        postId:'post1',
        country:'Sweden'
      })
      let post = Posts.findOne('post1')
      assert.strictEqual(post._likes.all, 1)
    })
    it('filtered count should be 1', function(){
      let post = Posts.findOne('post1')
      assert.strictEqual(post._likes.sweden, 1)
    })
  })
  describe('Insert child not matching filter', function(){
    it('unfiltered count should be 2', function(){
      Likes.insert({
        _id:'like2',
        postId:'post1',
        country:'Norway'
      })
      let post = Posts.findOne('post1')
      assert.strictEqual(post._likes.all, 2)
    })
    it('filtered count should be 1', function(){
      let post = Posts.findOne('post1')
      assert.strictEqual(post._likes.sweden, 1)
    })
  })
  describe('Insert new parent', function(){
    it('unfiltered count should be 2', function(){
      Likes.insert({
        _id:'like3',
        postId:'post6',
        country:'Sweden'
      })
      Likes.insert({
        _id:'like4',
        postId:'post6',
      })
      Posts.insert({_id:'post6'})
      let post = Posts.findOne('post6')
      assert.strictEqual(post._likes.all, 2)
    })
    it('filtered count should be 1', function(){
      let post = Posts.findOne('post6')
      assert.strictEqual(post._likes.sweden, 1)
    })
  })
  describe('Remove child not matching filter', function(){
    it('unfiltered count should be 1', function(){
      Likes.remove('like2')
      let post = Posts.findOne('post1')
      assert.strictEqual(post._likes.all, 1)
    })
    it('filtered count should be 1', function(){
      let post = Posts.findOne('post1')
      assert.strictEqual(post._likes.sweden, 1)
    })
  })
  describe('Remove child matching filter', function(){

    it('unfiltered count should be 1', function(){
      Likes.remove('like1')
      let post = Posts.findOne('post1')
      assert.strictEqual(post._likes.all, 0)
    })
    it('filtered count should be 1', function(){
      let post = Posts.findOne('post1')
      assert.strictEqual(post._likes.sweden, 0)
    })
  })
})

describe('cacheField', function(){
  describe('Insert document', function(){
    it('default transform field should be correct', function(done){
      Users.insert({
        _id:'simon',
        username:'Simon89',
        profile:{
          first_name:'Simon',
          last_name:'Herteby'
        }
      })
      Meteor.setTimeout(function(){
        let user = Users.findOne('simon')
        try {
          assert.strictEqual(user._defaultTransform, 'Simon89, Simon, Herteby')
          done()
        } catch(err){
          done(err)
        }
      }, 100)
    })
    it('custom transform field should be correct', function(done){
      Meteor.setTimeout(function(){
        let user = Users.findOne('simon')
        try {
          compare(user.nested._customTransform, ['Simon89', 'Simon', 'Herteby'])
          done()
        } catch(err){
          done(err)
        }
      }, 100)
    })
  })
  describe('Update document', function(){
    it('default transform field should be correct', function(done){
      Users.update('simon', {$set:{profile:{first_name:'Karl', last_name:'Svensson'}}})
      Meteor.setTimeout(function(){
        let user = Users.findOne('simon')
        try {
          assert.strictEqual(user._defaultTransform, 'Simon89, Karl, Svensson')
          done()
        } catch(err){
          done(err)
        }
      }, 100)
    })
    it('custom transform field should be correct', function(done){
      Meteor.setTimeout(function(){
        let user = Users.findOne('simon')
        try {
          compare(user.nested._customTransform, ['Simon89', 'Karl', 'Svensson'])
          done()
        } catch(err){
          done(err)
        }
      }, 100)
    })
  })
  describe('Unset field', function(){
    it('default transform field should be correct', function(done){
      Users.update('simon', {$unset:{username:1}})
      Meteor.setTimeout(function(){
        let user = Users.findOne('simon')
        try {
          assert.strictEqual(user._defaultTransform, 'Karl, Svensson')
          done()
        } catch(err){
          done(err)
        }
      }, 100)
    })
    it('custom transform field should be correct', function(done){
      Meteor.setTimeout(function(){
        let user = Users.findOne('simon')
        try {
          compare(user.nested._customTransform, [null, 'Karl', 'Svensson'])
          done()
        } catch(err){
          done(err)
        }
      }, 100)
    })
  })
  describe('Unset nested field', function(){
    it('default transform field should be correct', function(done){
      Users.update('simon', {$unset:{'profile.first_name':1}})
      Meteor.setTimeout(function(){
        let user = Users.findOne('simon')
        try {
          assert.strictEqual(user._defaultTransform, 'Svensson')
          done()
        } catch(err){
          done(err)
        }
      }, 100)
    })
    it('custom transform field should be correct', function(done){
      Meteor.setTimeout(function(){
        let user = Users.findOne('simon')
        try {
          compare(user.nested._customTransform, [null, null, 'Svensson'])
          done()
        } catch(err){
          done(err)
        }
      }, 100)
    })
  })
})

//Run the same tests but with nested fields

//This needs to be put in a test due to async tests
describe('Prepare for next tests', function(){
  it('clear collections', function(){
    Posts.remove({})
    Comments.remove({})
    Users.remove({})
    Images.remove({})
    Tags.remove({})
    Likes.remove({})
  })
  it('set up caches', function(){
    Posts.cache({
      type:'one',
      collection:Users,
      cacheField:'caches._author',
      referenceField:'nested.authorId',
      fields:{
        username:1, 
        profile:{
          first_name:1,
          last_name:1
        }
      },
    })
    Posts.cache({
      type:'inversed',
      collection:Comments,
      cacheField:'caches._comments',
      referenceField:'nested.postId',
      fields:{message:1},
    })
    Posts.cache({
      type:'many',
      collection:Images,
      cacheField:'caches._images',
      referenceField:'nested.images:_id',
      fields:{filename:1}
    })
    Posts.cache({
      type:'many-inversed',
      collection:Tags,
      cacheField:'caches._tags',
      referenceField:'nested.postIds:_id',
      fields:{name:1}
    })
    Posts.cacheCount({
      collection:Likes,
      cacheField:'caches._likes.all',
      referenceField:'nested.postId'
    })
    Posts.cacheCount({
      collection:Likes,
      cacheField:'caches._likes.sweden',
      referenceField:'nested.postId',
      selector:{country:'Sweden'}
    })
  })
})

describe('Same tests with nested referenceFields and cacheFields', function(){
  describe('Insert parent - no children', function(){
    it('one cache should not exist', function(){
      Posts.insert({
        _id:'post1',
        nested:{
          authorId:'user1',
          images:[{_id:'dog'}, {_id:'cat'}]
        }
      })
      let post = Posts.findOne('post1')
      assert.isUndefined(post.caches._author)
    })
    it('many cache should be empty array', function(){
      let post = Posts.findOne('post1')
      assert.isArray(post.caches._images)
      assert.strictEqual(post.caches._images.length, 0)
    })
    it('inverse cache should be empty array', function(){
      let post = Posts.findOne('post1')
      assert.isArray(post.caches._comments)
      assert.strictEqual(post.caches._comments.length, 0)
    })
    it('many-inverse cache should be empty array', function(){
      let post = Posts.findOne('post1')
      assert.isArray(post.caches._tags)
      assert.strictEqual(post.caches._tags.length, 0)
    })  
  })
  describe('Type: one', function(){
    describe('Insert child', function(){
      it('child should be deeply equal except _id', function(){
        Users.insert({
          _id:'user1',
          username:'Simon',
          profile:{
            first_name:'Simon',
            last_name:'Herteby'
          }
        })
        let post = Posts.findOne('post1')
        let user = Users.findOne('user1', {fields:{_id:0, username:1, profile:1}})
        compare(post.caches._author, user)
      })
    })
    describe('Update child', function(){
      it('cache should have the new values', function(){
        Users.update('user1', {$set:{'profile.last_name':'Svensson'}})
        let post = Posts.findOne('post1')
        let user = Users.findOne('user1', {fields:{_id:0, username:1, profile:1}})
        compare(post.caches._author, user)
      })
    })

    describe('Update parent referenceField', function(){
      it('cache should reflect the new child', function(){
        Users.insert({
          _id:'user2',
          username:'Karl',
          profile:{
            first_name:'Karl',
            last_name:'Henriksson'
          }
        })
        Posts.update('post1', {$set:{'nested.authorId':'user2'}})
        let post = Posts.findOne('post1')
        let user = Users.findOne('user2', {fields:{_id:0, username:1, profile:1}})
        compare(post.caches._author, user)
      })
    })
    describe('Remove child', function(){
      it('cache should be undefined', function(){
        Users.remove('user2')
        let post = Posts.findOne('post1')
        assert.isUndefined(post.caches._author)
      })
    })
    describe('Insert another parent', function(){
      it('new parent should have child in cache', function(){
        Posts.insert({
          _id:'post2',
          nested:{authorId:'user1'}
        })
        let post = Posts.findOne('post2')
        let user = Users.findOne('user1', {fields:{_id:0, username:1, profile:1}})
        compare(post.caches._author, user)
      })
    })
  })

  describe('Type: many', function(){
    describe('Insert child', function(){
      it('cache should contain child', function(){
        Images.insert({
          _id:'cat',
          filename:'cat.jpg'
        })
        let post = Posts.findOne('post1')
        let image = Images.findOne('cat')
        compare(post.caches._images, [image])
      })
    })
    describe('Insert another child', function(){
      it('cache should contain both children', function(){
        Images.insert({
          _id:'dog',
          filename:'dog.png'
        })
        let post = Posts.findOne('post1')
        let cat = Images.findOne('cat')
        let dog = Images.findOne('dog')
        compare(post.caches._images, [cat, dog])
      })
    })
    describe('Update children', function(){
      it('cache should contain both updated children', function(){
        Images.find().forEach(image => {
          Images.update(image._id, {$set:{filename:image.filename + '.zip'}})
        })
        let post = Posts.findOne('post1')
        let cat = Images.findOne('cat')
        let dog = Images.findOne('dog')
        compare(post.caches._images, [cat, dog])
      })
    })
    describe('Remove child', function(){
      it('cache should only contain the remaining child', function(){
        Images.remove('cat')
        let post = Posts.findOne('post1')
        let dog = Images.findOne('dog')
        compare(post.caches._images, [dog])
      })
    })
    describe('Insert unlinked child', function(){
      it('cache should not contain the inserted child', function(){
        Images.insert({
          _id:'horse',
          filename:'horse.gif'
        })
        let post = Posts.findOne('post1')
        let dog = Images.findOne('dog')
        compare(post.caches._images, [dog])
      })
    })
    describe('Add child to parent referenceField', function(){
      it('cache should contain both children', function(){
        Posts.update('post1', {$push:{'nested.images':{_id:'horse'}}})
        let post = Posts.findOne('post1')
        let horse = Images.findOne('horse')
        let dog = Images.findOne('dog')
        compare(post.caches._images, [dog, horse])
      })
    })
    describe('Remove child from parent referenceField', function(){
      it('cache should only contain remaining child', function(){
        Posts.update('post1', {$pull:{'nested.images':{_id:'dog'}}})
        let post = Posts.findOne('post1')
        let horse = Images.findOne('horse')
        compare(post.caches._images, [horse])
      })
    })
    describe('Insert another parent', function(){
      it('cache should have correct children', function(){
        Posts.insert({
          _id:'post3',
          nested:{
            images:[{_id:'dog'}, {_id:'horse'}]
          }
        })
        let post = Posts.findOne('post3')
        let dog = Images.findOne('dog')
        let horse = Images.findOne('horse')
        compare(post.caches._images, [dog, horse])
      })
    })
  })

  describe('Type: inversed', function(){
    describe('Insert child', function(){
      it('cache should contain child', function(){
        Comments.insert({
          _id:'comment1',
          message:'Hello world!',
          nested:{postId:'post1'}
        })
        let post = Posts.findOne('post1')
        let comment = Comments.findOne('comment1', {fields:{nested:0}})
        compare(post.caches._comments, [comment])
      })
    })
    describe('Insert another child', function(){
      it('cache should contain both children', function(){
        Comments.insert({
          _id:'comment2',
          message:'Hello world!',
          nested:{postId:'post1'}
        })
        let post = Posts.findOne('post1')
        let comment1 = Comments.findOne('comment1', {fields:{nested:0}})
        let comment2 = Comments.findOne('comment2', {fields:{nested:0}})
        compare(post.caches._comments, [comment1, comment2])
      })
    })
    describe('Insert unlinked child', function(){
      it('cache should not contain new child', function(){
        Comments.insert({
          _id:'comment3',
          message:'Hello world again!',
        })
        let post = Posts.findOne('post1')
        let comment1 = Comments.findOne('comment1', {fields:{nested:0}})
        let comment2 = Comments.findOne('comment2', {fields:{nested:0}})
        compare(post.caches._comments, [comment1, comment2])
      })
    })
    describe('Update child referenceField', function(){
      it('cache should contain new and previous children', function(){
        Comments.update('comment3', {$set:{'nested.postId':'post1'}})
        let post = Posts.findOne('post1')
        let comment1 = Comments.findOne('comment1', {fields:{nested:0}})
        let comment2 = Comments.findOne('comment2', {fields:{nested:0}})
        let comment3 = Comments.findOne('comment3', {fields:{nested:0}})
        compare(post.caches._comments, [comment1, comment2, comment3])
      })
    })
    describe('Update children', function(){
      it('cache should contain updated children', function(){
        Comments.update({}, {$set:{message:'Goodbye world!'}}, {multi:true})
        let post = Posts.findOne('post1')
        let comment1 = Comments.findOne('comment1', {fields:{nested:0}})
        let comment2 = Comments.findOne('comment2', {fields:{nested:0}})
        let comment3 = Comments.findOne('comment3', {fields:{nested:0}})
        compare(post.caches._comments, [comment1, comment2, comment3])
      })
    })
    describe('Remove child', function(){
      it('cache should only contain remaining children', function(){
        Comments.remove('comment2')
        let post = Posts.findOne('post1')
        let comment1 = Comments.findOne('comment1', {fields:{nested:0}})
        let comment3 = Comments.findOne('comment3', {fields:{nested:0}})
        compare(post.caches._comments, [comment1, comment3])
      })
    })
    describe('Remove parent from child referenceField', function(){
      it('cache should only contain remaining child', function(){
        Comments.update('comment3', {$unset:{'nested.postId':1}})
        let post = Posts.findOne('post1')
        let comment1 = Comments.findOne('comment1', {fields:{nested:0}})
        compare(post.caches._comments, [comment1])
      })
    })
    describe('Insert another parent', function(){
      it('cache should contain all children', function(){
        Comments.update({}, {$set:{'nested.postId':'post4'}}, {multi:true})
        Posts.insert({
          _id:'post4'
        })
        let post = Posts.findOne('post4')
        let comments = Comments.find({}, {fields:{nested:0}}).fetch()
        compare(post.caches._comments, comments)
      })
    })
  })

  describe('Type: many-inversed', function(){
    describe('Insert child', function(){
      it('parent1 should contain child', function(){
        Tags.insert({
          _id:'tag1',
          name:'Red',
          nested:{postIds:[{_id:'post1'}, {_id:'post2'}]}
        })
        let post1 = Posts.findOne('post1')
        let tag = Tags.findOne('tag1', {fields:{nested:0}})
        compare(post1.caches._tags, [tag])
      })
      it('parent2 should contain child', function(){
        let post2 = Posts.findOne('post2')
        let tag = Tags.findOne('tag1', {fields:{nested:0}})
        compare(post2.caches._tags, [tag])
      })
      it('parent3 should not contain child', function(){
        let post3 = Posts.findOne('post3')
        compare(post3.caches._tags, [])
      })
    })
    describe('Insert another child', function(){
      it('parent1 should contain both children', function(){
        Tags.insert({
          _id:'tag2',
          name:'Blue',
          nested:{postIds:[{_id:'post1'}, {_id:'post2'}]}
        })
        let post1 = Posts.findOne('post1')
        let tag1 = Tags.findOne('tag1', {fields:{nested:0}})
        let tag2 = Tags.findOne('tag2', {fields:{nested:0}})
        compare(post1.caches._tags, [tag1, tag2])
      })
      it('parent2 should contain both children', function(){
        let post2 = Posts.findOne('post2')
        let tag1 = Tags.findOne('tag1', {fields:{nested:0}})
        let tag2 = Tags.findOne('tag2', {fields:{nested:0}})
        compare(post2.caches._tags, [tag1, tag2])
      })
    })
    describe('Insert unlinked child', function(){
      it('cache should not contain new child', function(){
        Tags.insert({
          _id:'tag3',
          name:'Green'
        })
        let post = Posts.findOne('post1')
        let tag1 = Tags.findOne('tag1', {fields:{nested:0}})
        let tag2 = Tags.findOne('tag2', {fields:{nested:0}})
        compare(post.caches._tags, [tag1, tag2])
      })
    })
    describe('Update child referenceField', function(){
      it('parent1 should now contain the child', function(){
        Tags.update('tag3', {$set:{'nested.postIds':[{_id:'post1'}, {_id:'post2'}]}})
        let post1 = Posts.findOne('post1')
        let tag1 = Tags.findOne('tag1', {fields:{nested:0}})
        let tag2 = Tags.findOne('tag2', {fields:{nested:0}})
        let tag3 = Tags.findOne('tag3', {fields:{nested:0}})
        compare(post1.caches._tags, [tag1, tag2, tag3])
      })
      it('parent2 should now contain the child', function(){
        let post2 = Posts.findOne('post2')
        let tag1 = Tags.findOne('tag1', {fields:{nested:0}})
        let tag2 = Tags.findOne('tag2', {fields:{nested:0}})
        let tag3 = Tags.findOne('tag3', {fields:{nested:0}})
        compare(post2.caches._tags, [tag1, tag2, tag3])
      })
    })
    describe('Update children', function(){
      it('parent1 should contain updated children', function(){
        Tags.find().forEach(tag => {
          Tags.update(tag._id, {$set:{name:'color-' + tag.name}})
        })
        let post1 = Posts.findOne('post1')
        let tag1 = Tags.findOne('tag1', {fields:{nested:0}})
        let tag2 = Tags.findOne('tag2', {fields:{nested:0}})
        let tag3 = Tags.findOne('tag3', {fields:{nested:0}})
        compare(post1.caches._tags, [tag1, tag2, tag3])
      })
      it('parent2 should contain updated children', function(){
        let post2 = Posts.findOne('post2')
        let tag1 = Tags.findOne('tag1', {fields:{nested:0}})
        let tag2 = Tags.findOne('tag2', {fields:{nested:0}})
        let tag3 = Tags.findOne('tag3', {fields:{nested:0}})
        compare(post2.caches._tags, [tag1, tag2, tag3])
      })
    })
    describe('Remove child', function(){
      it('parent1 should only contain remaining children', function(){
        Tags.remove('tag1')
        let post1 = Posts.findOne('post1')
        let tag2 = Tags.findOne('tag2', {fields:{nested:0}})
        let tag3 = Tags.findOne('tag3', {fields:{nested:0}})
        compare(post1.caches._tags, [tag2, tag3])
      })
      it('parent2 should only contain remaining children', function(){
        let post2 = Posts.findOne('post2')
        let tag2 = Tags.findOne('tag2', {fields:{nested:0}})
        let tag3 = Tags.findOne('tag3', {fields:{nested:0}})
        compare(post2.caches._tags, [tag2, tag3])
      })
    })
    describe('Remove parent2 from child referenceField', function(){
      it('parent1 should still contain child', function(){
        Tags.update('tag3', {$pull:{'nested.postIds':{_id:'post2'}}})
        let post1 = Posts.findOne('post1')
        let tag2 = Tags.findOne('tag2', {fields:{nested:0}})
        let tag3 = Tags.findOne('tag3', {fields:{nested:0}})
        compare(post1.caches._tags, [tag2, tag3])
      })
      it('parent2 should not contain child', function(){
       let post2 = Posts.findOne('post2')
       let tag2 = Tags.findOne('tag2', {fields:{nested:0}})
       compare(post2.caches._tags, [tag2])
     })
    })
    describe('Insert another parent', function(){
      it('new parent should contain all children', function(){
        Tags.update({}, {$push:{'nested.postIds':{_id:'post5'}}}, {multi:true})
        Posts.insert({
          _id:'post5'
        })
        let post = Posts.findOne('post5')
        let tags = Tags.find({}, {fields:{nested:0}}).fetch()
        compare(post.caches._tags, tags)
      })
    })
  })
  describe('cacheCount', function(){
    describe('Insert child matching filter', function(){
      it('unfiltered count should be 1', function(){
        Likes.insert({
          _id:'like1',
          nested:{postId:'post1'},
          country:'Sweden'
        })
        let post = Posts.findOne('post1')
        assert.strictEqual(post.caches._likes.all, 1)
      })
      it('filtered count should be 1', function(){
        let post = Posts.findOne('post1')
        assert.strictEqual(post.caches._likes.sweden, 1)
      })
    })
    describe('Insert child not matching filter', function(){
      it('unfiltered count should be 2', function(){
        Likes.insert({
          _id:'like2',
          nested:{postId:'post1'},
          country:'Norway'
        })
        let post = Posts.findOne('post1')
        assert.strictEqual(post.caches._likes.all, 2)
      })
      it('filtered count should be 1', function(){
        let post = Posts.findOne('post1')
        assert.strictEqual(post.caches._likes.sweden, 1)
      })
    })
    describe('Insert new parent', function(){
      it('unfiltered count should be 2', function(){
        Likes.insert({
          _id:'like3',
          nested:{postId:'post6'},
          country:'Sweden'
        })
        Likes.insert({
          _id:'like4',
          nested:{postId:'post6'},
        })
        Posts.insert({_id:'post6'})
        let post = Posts.findOne('post6')
        assert.strictEqual(post.caches._likes.all, 2)
      })
      it('filtered count should be 1', function(){
        let post = Posts.findOne('post6')
        assert.strictEqual(post.caches._likes.sweden, 1)
      })
    })
    describe('Remove child not matching filter', function(){
      it('unfiltered count should be 1', function(){
        Likes.remove('like2')
        let post = Posts.findOne('post1')
        assert.strictEqual(post.caches._likes.all, 1)
      })
      it('filtered count should be 1', function(){
        let post = Posts.findOne('post1')
        assert.strictEqual(post.caches._likes.sweden, 1)
      })
    })
    describe('Remove child matching filter', function(){
      it('unfiltered count should be 1', function(){
        Likes.remove('like1')
        let post = Posts.findOne('post1')
        assert.strictEqual(post.caches._likes.all, 0)
      })
      it('filtered count should be 1', function(){
        let post = Posts.findOne('post1')
        assert.strictEqual(post.caches._likes.sweden, 0)
      })
    })
  })
})


describe('Recursive caching', function(){
  it('clear collections', function(){
    Customers.remove({})
    Bills.remove({})
    Items.remove({})
  })
  it('clear hooks', function(){
    _.each([Customers, Bills, Items], collection => {
      collection._hookAspects.insert.after = []
      collection._hookAspects.update.after = []
      collection._hookAspects.remove.after = []
    })
  })
  it('set up caches', function(){
    //Option one
    Customers.cache({
      cacheField:'_bills',
      collection:Bills,
      type:'inverse',
      referenceField:'customerId',
      fields:['_sum', '_items']
    })

    Bills.cache({
      cacheField:'_items',
      collection:Items,
      type:'many',
      referenceField:'itemIds',
      fields:['name', 'price']
    })
    //Option two
    Customers.cache({
      cacheField:'_bills2',
      collection:Bills,
      type:'inverse',
      referenceField:'customerId',
      fields:['itemIds', '_sum']
    })
    Customers.cache({
      cacheField:'_items',
      collection:Items,
      type:'many',
      referenceField:'_bills2:itemIds',
      fields:['name', 'price']
    })

    Bills.cacheField({
      fields:['_items'],
      cacheField:'_sum',
      transform(doc){
        let price = _.sum(_.map(doc._items, 'price'))
        return price
      }
    })
  })
  describe('Insert documents', function(){
    it('All caches should have correct values', function(done){
      Customers.insert({
        _id:'customer1',
      })
      Bills.insert({
        _id:'bill1',
        customerId:'customer1',
        itemIds:['item1', 'item2']
      })
      Bills.insert({
        _id:'bill2',
        customerId:'customer1',
        itemIds:['item3', 'item4']
      })
      Items.insert({
        _id:'item1',
        name:'Muffin',
        price:30
      })
      Items.insert({
        _id:'item2',
        name:'Coffee',
        price:25
      })
      Items.insert({
        _id:'item3',
        name:'Cake',
        price:40
      })
      Items.insert({
        _id:'item4',
        name:'Tea',
        price:25
      })
      let expected = {
        _bills:[
        {
          _id:'bill1',
          _items:[
          {_id:'item1', name:'Muffin', price:30},
          {_id:'item2', name:'Coffee', price:25},
          ],
          _sum:55
        },
        {
          _id:'bill2',
          _items:[
          {_id:'item3', name:'Cake', price:40},
          {_id:'item4', name:'Tea', price:25},
          ],
          _sum:65
        }
        ],
        _bills2:[
        {_id:'bill1', _sum:55, itemIds:['item1', 'item2']},
        {_id:'bill2', _sum:65, itemIds:['item3', 'item4']}
        ],
        _items:[
        {_id:'item1', name:'Muffin', price:30},
        {_id:'item2', name:'Coffee', price:25},
        {_id:'item3', name:'Cake', price:40},
        {_id:'item4', name:'Tea', price:25},
        ]
      }
      Meteor.setTimeout(function(){
        let customer = Customers.findOne('customer1', {fields:{_id:0}})
        try{
          compare(expected, customer)
          done()
        } catch(err){
          done(err)
        }
      }, 100)
    })
  })
  describe('update a child', function(done){
    it('all caches should be updated with correct values', function(done){
      Bills.update('bill1', {$push:{itemIds:'item3'}})
      let expected = {
        _bills:[
        {
          _id:'bill1',
          _items:[
          {_id:'item1', name:'Muffin', price:30},
          {_id:'item2', name:'Coffee', price:25},
          {_id:'item3', name:'Cake', price:40},
          ],
          _sum:95
        },
        {
          _id:'bill2',
          _items:[
          {_id:'item3', name:'Cake', price:40},
          {_id:'item4', name:'Tea', price:25},
          ],
          _sum:65
        }
        ],
        _bills2:[
        {_id:'bill1', _sum:95, itemIds:['item1', 'item2', 'item3']},
        {_id:'bill2', _sum:65, itemIds:['item3', 'item4']}
        ],
        _items:[
        {_id:'item1', name:'Muffin', price:30},
        {_id:'item2', name:'Coffee', price:25},
        {_id:'item3', name:'Cake', price:40},
        {_id:'item4', name:'Tea', price:25},
        ]
      }
      Meteor.setTimeout(function(){
        let customer = Customers.findOne('customer1', {fields:{_id:0}})
        try{
          compare(customer, expected)
          done()
        } catch(err){
          done(err)
        }
      }, 100)
    })
  })
  describe('update a grandchild', function(done){
    it('all caches should be updated with correct values', function(done){
      Items.update('item1', {$set:{price:15}})
      let expected = {
        _bills:[
        {
          _id:'bill1',
          _items:[
          {_id:'item1', name:'Muffin', price:15},
          {_id:'item2', name:'Coffee', price:25},
          {_id:'item3', name:'Cake', price:40},
          ],
          _sum:80
        },
        {
          _id:'bill2',
          _items:[
          {_id:'item3', name:'Cake', price:40},
          {_id:'item4', name:'Tea', price:25},
          ],
          _sum:65
        }
        ],
        _bills2:[
        {_id:'bill1', _sum:80, itemIds:['item1', 'item2', 'item3']},
        {_id:'bill2', _sum:65, itemIds:['item3', 'item4']}
        ],
        _items:[
        {_id:'item1', name:'Muffin', price:15},
        {_id:'item2', name:'Coffee', price:25},
        {_id:'item3', name:'Cake', price:40},
        {_id:'item4', name:'Tea', price:25},
        ]
      }
      Meteor.setTimeout(function(){
        let customer = Customers.findOne('customer1', {fields:{_id:0}})
        try{
          compare(customer, expected)
          done()
        } catch(err){
          done(err)
        }
      }, 100)
    })
  })
  describe('remove a grandchild', function(done){
    it('all caches should be updated with correct values', function(done){
      Items.remove('item2')
      let expected = {
        _bills:[
        {
          _id:'bill1',
          _items:[
          {_id:'item1', name:'Muffin', price:15},
          {_id:'item3', name:'Cake', price:40},
          ],
          _sum:55
        },
        {
          _id:'bill2',
          _items:[
          {_id:'item3', name:'Cake', price:40},
          {_id:'item4', name:'Tea', price:25},
          ],
          _sum:65
        }
        ],
        _bills2:[
          {_id:'bill1', _sum:55, itemIds:['item1', 'item2', 'item3']}, //item2 will still be in itemIds
          {_id:'bill2', _sum:65, itemIds:['item3', 'item4']}
          ],
          _items:[
          {_id:'item1', name:'Muffin', price:15},
          {_id:'item3', name:'Cake', price:40},
          {_id:'item4', name:'Tea', price:25},
          ]
        }
        Meteor.setTimeout(function(){
          let customer = Customers.findOne('customer1', {fields:{_id:0}})
          try{
            compare(customer, expected)
            done()
          } catch(err){
            done(err)
          }
        }, 100)
      })
  })
  describe('add a grandchild', function(done){
    it('all caches should be updated with correct values', function(done){
      Items.insert({
        _id:'item2',
        name:'Espresso',
        price:35
      })
      let expected = {
        _bills:[
        {
          _id:'bill1',
          _items:[
          {_id:'item1', name:'Muffin', price:15},
          {_id:'item3', name:'Cake', price:40},
          {_id:'item2', name:'Espresso', price:35},
          ],
          _sum:90
        },
        {
          _id:'bill2',
          _items:[
          {_id:'item3', name:'Cake', price:40},
          {_id:'item4', name:'Tea', price:25},
          ],
          _sum:65
        }
        ],
        _bills2:[
          {_id:'bill1', _sum:90, itemIds:['item1', 'item2', 'item3']}, //item2 will still be in itemIds
          {_id:'bill2', _sum:65, itemIds:['item3', 'item4']}
          ],
          _items:[
          {_id:'item1', name:'Muffin', price:15},
          {_id:'item2', name:'Espresso', price:35},
          {_id:'item3', name:'Cake', price:40},
          {_id:'item4', name:'Tea', price:25},
          ]
        }
        Meteor.setTimeout(function(){
          let customer = Customers.findOne('customer1', {fields:{_id:0}})
          try{
            compare(customer, expected)
            done()
          } catch(err){
            done(err)
          }
        }, 100)
      })
  })
  describe('remove a child', function(done){
    it('all caches should be updated with correct values', function(done){
      Bills.remove('bill1')
      let expected = {
        _bills:[
        {
          _id:'bill2',
          _items:[
          {_id:'item3', name:'Cake', price:40},
          {_id:'item4', name:'Tea', price:25},
          ],
          _sum:65
        }
        ],
        _bills2:[
        {_id:'bill2', _sum:65, itemIds:['item3', 'item4']}
        ],
        _items:[
        {_id:'item3', name:'Cake', price:40},
        {_id:'item4', name:'Tea', price:25},
        ]
      }
      Meteor.setTimeout(function(){
        let customer = Customers.findOne('customer1', {fields:{_id:0}})
        try{
          compare(customer, expected)
          done()
        } catch(err){
          done(err)
        }
      }, 100)
    })
  })
})
