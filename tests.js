import {Mongo} from 'meteor/mongo'
import _ from 'lodash'

Posts = new Mongo.Collection('posts')
Comments = new Mongo.Collection('comments')
Users = new Mongo.Collection('users')
Images = new Mongo.Collection('images')
Posts.remove({})
Comments.remove({})
Users.remove({})
Images.remove({})

//Set up the caches
Posts.cache({
	type:'single',
	collection:Users,
	cacheField:'_author',
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
	cacheField:'_comments',
	referenceField:'nested.postId',
	fields:{message:1},
})
Posts.cache({
	type:'many',
	collection:Images,
	cacheField:'_images',
	referenceField:'imageIds',
	fields:{filename:1}
})

describe('Insert parent - no children', function(){
	Posts.insert({
		_id:'post1',
		nested:{authorId:'user1'},
		imageIds:['dog', 'cat']
	})
	let post = Posts.findOne('post1')
	it('single cache should not exist', function(){
		assert.isUndefined(post._author)
	})
	it('many cache should be empty array', function(){
		assert.isArray(post._images)
		assert.equal(post._images.length, 0)
	})
	it('inverse cache should be empty array', function(){
		assert.isArray(post._comments)
		assert.equal(post._comments.length, 0)
	})	
})
describe('Type: single', function(){
	describe('Insert child', function(){
		Users.insert({
			_id:'user1',
			username:'Simon',
			profile:{
				first_name:'Simon',
				last_name:'Herteby'
			}
		})
		let post = Posts.findOne('post1')
		let user = Users.findOne('user1', {fields:{_id:0}})
		it('child should be deeply equal except _id', function(){
			assert.deepEqual(post._author, user)
		})
	})
	describe('Update child', function(){
		Users.update('user1', {$set:{'profile.last_name':'Svensson'}})
		let post = Posts.findOne('post1')
		let user = Users.findOne('user1', {fields:{_id:0}})
		it('cache should have the new values', function(){
			assert.deepEqual(post._author, user)
		})
	})
	
	describe('Update parent referenceField', function(){
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
		let user = Users.findOne('user2', {fields:{_id:0}})
		it('cache should reflect the new child', function(){
			assert.deepEqual(post._author, user)
		})
	})
	describe('Remove child', function(){
		Users.remove('user2')
		let post = Posts.findOne('post1')
		it('cache should be undefined', function(){
			assert.isUndefined(post._author)
		})
	})
	describe('Insert another parent', function(){
		Posts.insert({
			_id:'post2',
			nested:{authorId:'user1'}
		})
		let post = Posts.findOne('post2')
		let user = Users.findOne('user1', {fields:{_id:0}})
		it('new parent should have child in cache', function(){
			assert.deepEqual(post._author, user)
		})
	})
})


describe('Type: many', function(){
	describe('Insert child', function(){
		Images.insert({
			_id:'cat',
			filename:'cat.jpg'
		})
		let post = Posts.findOne('post1')
		let image = Images.findOne('cat')
		it('cache should contain child', function(){
			assert.deepEqual(post._images, [image])
		})
	})
	describe('Insert another child', function(){
		Images.insert({
			_id:'dog',
			filename:'dog.png'
		})
		let post = Posts.findOne('post1')
		let cat = Images.findOne('cat')
		let dog = Images.findOne('dog')
		it('cache should contain both children', function(){
			assert.deepEqual(post._images, [cat, dog])
		})
	})
	describe('Update children', function(){
		Images.find().forEach(image => {
			Images.update(image._id, {$set:{filename:image.filename + '.zip'}})
		})
		let post = Posts.findOne('post1')
		let cat = Images.findOne('cat')
		let dog = Images.findOne('dog')
		it('cache should contain both updated children', function(){
			assert.deepEqual(post._images, [cat, dog])
		})
	})
	describe('Remove child', function(){
		Images.remove('cat')
		let post = Posts.findOne('post1')
		let dog = Images.findOne('dog')
		it('cache should only contain the remaining child', function(){
			assert.deepEqual(post._images, [dog])
		})
	})
	describe('Insert unlinked child', function(){
		Images.insert({
			_id:'horse',
			filename:'horse.gif'
		})
		let post = Posts.findOne('post1')
		let dog = Images.findOne('dog')
		it('cache should not contain the inserted child', function(){
			assert.deepEqual(post._images, [dog])
		})
	})
	describe('Add child to parent referenceField', function(){
		Posts.update('post1', {$push:{imageIds:'horse'}})
		let post = Posts.findOne('post1')
		let horse = Images.findOne('horse')
		let dog = Images.findOne('dog')
		it('cache should contain both children', function(){
			assert.deepEqual(post._images, [dog, horse])
		})
	})
	describe('Remove child from parent referenceField', function(){
		Posts.update('post1', {$pull:{imageIds:'dog'}})
		let post = Posts.findOne('post1')
		let horse = Images.findOne('horse')
		it('cache should only contain remaining child', function(){
			assert.deepEqual(post._images, [horse])
		})
	})
	describe('Insert another parent', function(){
		Posts.insert({
			_id:'post3',
			imageIds:['dog', 'horse']
		})
		let post = Posts.findOne('post3')
		let dog = Images.findOne('dog')
		let horse = Images.findOne('horse')
		it('cache should have correct children', function(){
			assert.deepEqual(post._images, [dog, horse])
		})
	})
})


describe('Type: inversed', function(){
	describe('Insert child', function(){
		Comments.insert({
			_id:'comment1',
			message:'Hello world!',
			nested:{postId:'post1'}
		})
		let post = Posts.findOne('post1')
		let comment = Comments.findOne('comment1')
		it('cache should contain child', function(){
			assert.deepEqual(post._comments, [comment])
		})
	})
	describe('Insert another child', function(){
		Comments.insert({
			_id:'comment2',
			message:'Hello world!',
			nested:{postId:'post1'}
		})
		let post = Posts.findOne('post1')
		let comment1 = Comments.findOne('comment1')
		let comment2 = Comments.findOne('comment2')
		it('cache should contain both children', function(){
			assert.deepEqual(post._comments, [comment1, comment2])
		})
	})
	describe('Insert unlinked child', function(){
		Comments.insert({
			_id:'comment3',
			message:'Hello world again!',
		})
		let post = Posts.findOne('post1')
		let comment1 = Comments.findOne('comment1')
		let comment2 = Comments.findOne('comment2')
		it('cache should not contain new child', function(){
			assert.deepEqual(post._comments, [comment1, comment2])
		})
	})
	describe('Update child referenceField', function(){
		Comments.update('comment3', {$set:{'nested.postId':'post1'}})
		let post = Posts.findOne('post1')
		let comment1 = Comments.findOne('comment1')
		let comment2 = Comments.findOne('comment2')
		let comment3 = Comments.findOne('comment3')
		it('cache should contain new and previous children', function(){
			assert.deepEqual(post._comments, [comment1, comment2, comment3])
		})
	})
	describe('Update children', function(){
		Comments.update({}, {$set:{message:'Goodbye world!'}}, {multi:true})
		let post = Posts.findOne('post1')
		let comment1 = Comments.findOne('comment1')
		let comment2 = Comments.findOne('comment2')
		let comment3 = Comments.findOne('comment3')
		it('cache should contain updated children', function(){
			assert.deepEqual(post._comments, [comment1, comment2, comment3])
		})
	})
	describe('Remove child', function(){
		Comments.remove('comment2')
		let post = Posts.findOne('post1')
		let comment1 = Comments.findOne('comment1')
		let comment3 = Comments.findOne('comment3')
		it('cache should only contain remaining children', function(){
			assert.deepEqual(post._comments, [comment1, comment3])
		})
	})
	describe('Remove parent from child referenceField', function(){
		Comments.update('comment3', {$unset:{'nested.postId':1}})
		let post = Posts.findOne('post1')
		let comment1 = Comments.findOne('comment1')
		it('cache should only contain remaining child', function(){
			assert.deepEqual(post._comments, [comment1])
		})
	})
	describe('Insert another parent', function(){
		Comments.update({}, {$set:{'nested.postId':'post4'}}, {multi:true})
		Posts.insert({
			_id:'post4'
		})
		let post = Posts.findOne('post4')
		let comments = Comments.find().fetch()
		it('cache should contain all children', function(){
			assert.deepEqual(post._comments, comments)
		})
	})
})