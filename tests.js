import { Mongo } from 'meteor/mongo';
import { assert } from 'chai';
import _ from 'lodash';
import { MigrationHistory, migrate, autoMigrate } from './migrations.js';
function report(result, expected, path = '') {
  let keys = _.union(_.keys(result), _.keys(expected));
  _.each(keys, (key) => {
    if (!_.isEqual(result[key], expected[key])) {
      console.log('MISMATCH:', key);
      console.log('Expected:', JSON.stringify(expected[key], null, ' '));
      console.log('     Got:', JSON.stringify(result[key], null, ' '));
    }
  });
}
function compare(result, expected) {
  try {
    assert.deepEqual(result, expected);
  } catch (err) {
    report(result, expected);
    throw err;
  }
}

Posts = new Mongo.Collection('posts'); //parent
Comments = new Mongo.Collection('comments'); //inversed
Users = new Mongo.Collection('users'); //single
Images = new Mongo.Collection('images'); //many
Tags = new Mongo.Collection('tags'); //many-inversed
Likes = new Mongo.Collection('likes'); // count
Customers = new Mongo.Collection('customers'); //recursive caches
Bills = new Mongo.Collection('bills'); //recursive caches
Items = new Mongo.Collection('items'); //recursive caches

describe('setup', function () {
  it('clear collections', async function () {
    await Posts.removeAsync({});
    await Comments.removeAsync({});
    await Users.removeAsync({});
    await Images.removeAsync({});
    await Tags.removeAsync({});
    await Likes.removeAsync({});
    await MigrationHistory.removeAsync({});
  });
  it('clear hooks', function () {
    //Remove all collection hooks so that migration tests work properly
    _.each([Posts, Comments, Users, Images, Tags, Likes], (collection) => {
      collection._hooks.insert.after = [];
      collection._hooks.update.after = [];
      collection._hooks.remove.after = [];
    });
  });
  it('insert migrants', async function () {
    //These users inserted before the caches have been declared, so they will need to be migrated
    await Users.insertAsync({
      _id: 'migrant1',
      username: 'Simon',
      profile: {
        first_name: 'Simon',
        last_name: 'Herteby',
      },
    });
    await Users.insertAsync({
      _id: 'migrant2',
      username: 'bill_gates@microsoft.com',
      profile: {
        first_name: 'Bill',
        last_name: 'Gates',
      },
    });
    await Users.insertAsync({
      _id: 'migrant3',
      username: 'steve_jobs@apple.com',
      profile: {
        first_name: 'Steve',
        last_name: 'Jobs',
      },
    });
  });
  it('Set up caches', function () {
    Posts.cache({
      type: 'one',
      collection: Users,
      cacheField: '_author',
      referenceField: 'authorId',
      fields: {
        username: 1,
        profile: {
          first_name: 1,
          last_name: 1,
        },
      },
    });
    Posts.cache({
      type: 'inversed',
      collection: Comments,
      cacheField: '_comments',
      referenceField: 'postId',
      fields: { message: 1 },
    });
    Posts.cache({
      type: 'many',
      collection: Images,
      cacheField: '_images',
      referenceField: 'imageIds',
      fields: { filename: 1 },
    });
    Posts.cache({
      type: 'many-inversed',
      collection: Tags,
      cacheField: '_tags',
      referenceField: 'postIds',
      fields: { name: 1 },
    });
    Posts.cacheCount({
      collection: Likes,
      cacheField: '_likes.all',
      referenceField: 'postId',
    });
    Posts.cacheCount({
      collection: Likes,
      cacheField: '_likes.sweden',
      referenceField: 'postId',
      selector: { country: 'Sweden' },
    });
    Users.cacheField({
      cacheField: '_defaultTransform',
      fields: ['username', 'profile.first_name', 'profile.last_name'],
    });
    Users.cacheField({
      cacheField: 'nested._customTransform',
      fields: ['username', 'profile.first_name', 'profile.last_name'],
      transform(doc) {
        return [
          doc.username,
          _.get(doc, 'profile.first_name'),
          _.get(doc, 'profile.last_name'),
        ];
      },
    });
  });
});

describe('Migration', function () {
  describe('migrate()', function () {
    it('user should not have cache before migration', async function () {
      let migrant1 = await Users.findOneAsync('migrant1');
      compare(migrant1, {
        _id: 'migrant1',
        username: 'Simon',
        profile: {
          first_name: 'Simon',
          last_name: 'Herteby',
        },
      });
    });
    it('migrated document should have the correct caches', async function () {
      await migrate('users', '_defaultTransform', 'migrant1');
      await migrate('users', 'nested._customTransform', { _id: 'migrant1' });
      let migrant1 = await Users.findOneAsync('migrant1');
      compare(migrant1, {
        _id: 'migrant1',
        username: 'Simon',
        profile: {
          first_name: 'Simon',
          last_name: 'Herteby',
        },
        _defaultTransform: 'Simon, Simon, Herteby',
        nested: { _customTransform: ['Simon', 'Simon', 'Herteby'] },
      });
    });
    it('documents not matching selector should not have caches', async function () {
      let migrant2 = await Users.findOneAsync('migrant2');
      let migrant3 = await Users.findOneAsync('migrant3');
      compare(migrant2, {
        _id: 'migrant2',
        username: 'bill_gates@microsoft.com',
        profile: {
          first_name: 'Bill',
          last_name: 'Gates',
        },
      });
      compare(migrant3, {
        _id: 'migrant3',
        username: 'steve_jobs@apple.com',
        profile: {
          first_name: 'Steve',
          last_name: 'Jobs',
        },
      });
    });
  });
  describe('autoMigrate()', function () {
    it('migrated documents should have the correct caches', async function () {
      await autoMigrate();
      console.log(
        "(Don't worry about the console log saying 'migrated 0 docs' a bunch of times. That is correct.)",
      );
      let migrant2 = await Users.findOneAsync('migrant2');
      let migrant3 = await Users.findOneAsync('migrant3');
      compare(migrant2, {
        _id: 'migrant2',
        username: 'bill_gates@microsoft.com',
        profile: {
          first_name: 'Bill',
          last_name: 'Gates',
        },
        _defaultTransform: 'bill_gates@microsoft.com, Bill, Gates',
        nested: {
          _customTransform: ['bill_gates@microsoft.com', 'Bill', 'Gates'],
        },
      });
      compare(migrant3, {
        _id: 'migrant3',
        username: 'steve_jobs@apple.com',
        profile: {
          first_name: 'Steve',
          last_name: 'Jobs',
        },
        _defaultTransform: 'steve_jobs@apple.com, Steve, Jobs',
        nested: { _customTransform: ['steve_jobs@apple.com', 'Steve', 'Jobs'] },
      });
    });
  });
});

describe('Insert parent - no children', function () {
  it('one cache should not exist', async function () {
    await Posts.insertAsync({
      _id: 'post1',
      authorId: 'user1',
      imageIds: ['dog', 'cat'],
    });
    assert.isUndefined((await Posts.findOneAsync('post1'))._author);
  });
  it('many cache should be empty array', async function () {
    assert.isArray((await Posts.findOneAsync('post1'))._images);
    assert.strictEqual((await Posts.findOneAsync('post1'))._images.length, 0);
  });
  it('inversed cache should be empty array', async function () {
    assert.isArray((await Posts.findOneAsync('post1'))._comments);
    assert.strictEqual((await Posts.findOneAsync('post1'))._comments.length, 0);
  });
  it('many-inversed cache should be empty array', async function () {
    assert.isArray((await Posts.findOneAsync('post1'))._tags);
    assert.strictEqual((await Posts.findOneAsync('post1'))._tags.length, 0);
  });
  it('unfiltered count should be 0', async function () {
    assert.strictEqual((await Posts.findOneAsync('post1'))._likes.all, 0);
  });
  it('filtered count should be 0', async function () {
    assert.strictEqual((await Posts.findOneAsync('post1'))._likes.sweden, 0);
  });
});
describe('Type: one', function () {
  describe('Insert child', function () {
    it('child should be deeply equal except _id', async function () {
      await Users.insertAsync({
        _id: 'user1',
        username: 'Simon',
        profile: {
          first_name: 'Simon',
          last_name: 'Herteby',
        },
      });
      let post = await Posts.findOneAsync('post1');
      let user = await Users.findOneAsync('user1', {
        fields: { _id: 0, username: 1, profile: 1 },
      });
      compare(post._author, user);
    });
  });
  describe('Update child', function () {
    it('cache should have the new values', async function () {
      await Users.updateAsync('user1', {
        $set: { 'profile.last_name': 'Svensson' },
      });
      let post = await Posts.findOneAsync('post1');
      let user = await Users.findOneAsync('user1', {
        fields: { _id: 0, username: 1, profile: 1 },
      });
      compare(post._author, user);
    });
  });

  describe('Update parent referenceField', function () {
    it('cache should reflect the new child', async function () {
      await Users.insertAsync({
        _id: 'user2',
        username: 'Karl',
        profile: {
          first_name: 'Karl',
          last_name: 'Henriksson',
        },
      });
      await Posts.updateAsync('post1', { $set: { authorId: 'user2' } });
      let post = await Posts.findOneAsync('post1');
      let user = await Users.findOneAsync('user2', {
        fields: { _id: 0, username: 1, profile: 1 },
      });
      compare(post._author, user);
    });
  });
  describe('Remove child', function () {
    it('cache should be undefined', async function () {
      await Users.removeAsync('user2');
      let post = await Posts.findOneAsync('post1');
      assert.isUndefined(post._author);
    });
  });
  describe('Insert another parent', function () {
    it('new parent should have child in cache', async function () {
      await Posts.insertAsync({
        _id: 'post2',
        authorId: 'user1',
      });
      let post = await Posts.findOneAsync('post2');
      let user = await Users.findOneAsync('user1', {
        fields: { _id: 0, username: 1, profile: 1 },
      });
      compare(post._author, user);
    });
  });
});

describe('Type: many', function () {
  describe('Insert child', function () {
    it('cache should contain child', async function () {
      await Images.insertAsync({
        _id: 'cat',
        filename: 'cat.jpg',
      });
      let post = await Posts.findOneAsync('post1');
      let image = await Images.findOneAsync('cat');
      compare(post._images, [image]);
    });
  });
  describe('Insert another child', function () {
    it('cache should contain both children', async function () {
      await Images.insertAsync({
        _id: 'dog',
        filename: 'dog.png',
      });
      let post = await Posts.findOneAsync('post1');
      let cat = await Images.findOneAsync('cat');
      let dog = await Images.findOneAsync('dog');
      compare(post._images, [cat, dog]);
    });
  });
  describe('Update children', function () {
    it('cache should contain both updated children', async function () {
      await Images.find().forEachAsync(async (image) => {
        await Images.updateAsync(image._id, {
          $set: { filename: image.filename + '.zip' },
        });
      });
      let post = await Posts.findOneAsync('post1');
      let cat = await Images.findOneAsync('cat');
      let dog = await Images.findOneAsync('dog');
      compare(post._images, [cat, dog]);
    });
  });
  describe('Remove child', function () {
    it('cache should only contain the remaining child', async function () {
      await Images.removeAsync('cat');
      let post = await Posts.findOneAsync('post1');
      let dog = await Images.findOneAsync('dog');
      compare(post._images, [dog]);
    });
  });
  describe('Insert unlinked child', function () {
    it('cache should not contain the inserted child', async function () {
      await Images.insertAsync({
        _id: 'horse',
        filename: 'horse.gif',
      });
      let post = await Posts.findOneAsync('post1');
      let dog = await Images.findOneAsync('dog');
      compare(post._images, [dog]);
    });
  });
  describe('Add child to parent referenceField', function () {
    it('cache should contain both children', async function () {
      await Posts.updateAsync('post1', { $push: { imageIds: 'horse' } });
      let post = await Posts.findOneAsync('post1');
      let horse = await Images.findOneAsync('horse');
      let dog = await Images.findOneAsync('dog');
      compare(post._images, [dog, horse]);
    });
  });
  describe('Remove child from parent referenceField', function () {
    it('cache should only contain remaining child', async function () {
      await Posts.updateAsync('post1', { $pull: { imageIds: 'dog' } });
      let post = await Posts.findOneAsync('post1');
      let horse = await Images.findOneAsync('horse');
      compare(post._images, [horse]);
    });
  });
  describe('Insert another parent', function () {
    it('cache should have correct children', async function () {
      await Posts.insertAsync({
        _id: 'post3',
        imageIds: ['dog', 'horse'],
      });
      let post = await Posts.findOneAsync('post3');
      let dog = await Images.findOneAsync('dog');
      let horse = await Images.findOneAsync('horse');
      compare(post._images, [dog, horse]);
    });
  });
});

describe('Type: inversed', function () {
  describe('Insert child', function () {
    it('cache should contain child', async function () {
      await Comments.insertAsync({
        _id: 'comment1',
        message: 'Hello world!',
        postId: 'post1',
      });
      let post = await Posts.findOneAsync('post1');
      let comment = await Comments.findOneAsync('comment1', {
        fields: { postId: 0 },
      });
      compare(post._comments, [comment]);
    });
  });
  describe('Insert another child', function () {
    it('cache should contain both children', async function () {
      await Comments.insertAsync({
        _id: 'comment2',
        message: 'Hello world!',
        postId: 'post1',
      });
      let post = await Posts.findOneAsync('post1');
      let comment1 = await Comments.findOneAsync('comment1', {
        fields: { postId: 0 },
      });
      let comment2 = await Comments.findOneAsync('comment2', {
        fields: { postId: 0 },
      });
      compare(post._comments, [comment1, comment2]);
    });
  });
  describe('Insert unlinked child', function () {
    it('cache should not contain new child', async function () {
      await Comments.insertAsync({
        _id: 'comment3',
        message: 'Hello world again!',
      });
      let post = await Posts.findOneAsync('post1');
      let comment1 = await Comments.findOneAsync('comment1', {
        fields: { postId: 0 },
      });
      let comment2 = await Comments.findOneAsync('comment2', {
        fields: { postId: 0 },
      });
      compare(post._comments, [comment1, comment2]);
    });
  });
  describe('Update child referenceField', function () {
    it('cache should contain new and previous children', async function () {
      await Comments.updateAsync('comment3', { $set: { postId: 'post1' } });
      let post = await Posts.findOneAsync('post1');
      let comment1 = await Comments.findOneAsync('comment1', {
        fields: { postId: 0 },
      });
      let comment2 = await Comments.findOneAsync('comment2', {
        fields: { postId: 0 },
      });
      let comment3 = await Comments.findOneAsync('comment3', {
        fields: { postId: 0 },
      });
      compare(post._comments, [comment1, comment2, comment3]);
    });
  });
  describe('Update children', function () {
    it('cache should contain updated children', async function () {
      await Comments.updateAsync(
        {},
        { $set: { message: 'Goodbye world!' } },
        { multi: true },
      );
      let post = await Posts.findOneAsync('post1');
      let comment1 = await Comments.findOneAsync('comment1', {
        fields: { postId: 0 },
      });
      let comment2 = await Comments.findOneAsync('comment2', {
        fields: { postId: 0 },
      });
      let comment3 = await Comments.findOneAsync('comment3', {
        fields: { postId: 0 },
      });
      compare(post._comments, [comment1, comment2, comment3]);
    });
  });
  describe('Remove child', function () {
    it('cache should only contain remaining children', async function () {
      await Comments.removeAsync('comment2');
      let post = await Posts.findOneAsync('post1');
      let comment1 = await Comments.findOneAsync('comment1', {
        fields: { postId: 0 },
      });
      let comment3 = await Comments.findOneAsync('comment3', {
        fields: { postId: 0 },
      });
      compare(post._comments, [comment1, comment3]);
    });
  });
  describe('Remove parent from child referenceField', function () {
    it('cache should only contain remaining child', async function () {
      await Comments.updateAsync('comment3', { $unset: { postId: 1 } });
      let post = await Posts.findOneAsync('post1');
      let comment1 = await Comments.findOneAsync('comment1', {
        fields: { postId: 0 },
      });
      compare(post._comments, [comment1]);
    });
  });
  describe('Insert another parent', function () {
    it('cache should contain all children', async function () {
      await Comments.updateAsync(
        {},
        { $set: { postId: 'post4' } },
        { multi: true },
      );
      await Posts.insertAsync({
        _id: 'post4',
      });
      let post = await Posts.findOneAsync('post4');
      let comments = await Comments.find(
        {},
        { fields: { postId: 0 } },
      ).fetchAsync();
      compare(post._comments, comments);
    });
  });
});

describe('Type: many-inversed', function () {
  describe('Insert child', function () {
    it('parent1 should contain child', async function () {
      await Tags.insertAsync({
        _id: 'tag1',
        name: 'Red',
        postIds: ['post1', 'post2'],
      });
      let post1 = await Posts.findOneAsync('post1');
      let tag = await Tags.findOneAsync('tag1', { fields: { postIds: 0 } });
      compare(post1._tags, [tag]);
    });
    it('parent2 should contain child', async function () {
      let post2 = await Posts.findOneAsync('post2');
      let tag = await Tags.findOneAsync('tag1', { fields: { postIds: 0 } });
      compare(post2._tags, [tag]);
    });
    it('parent3 should not contain child', async function () {
      let post3 = await Posts.findOneAsync('post3');
      compare(post3._tags, []);
    });
  });
  describe('Insert another child', function () {
    it('parent1 should contain both children', async function () {
      await Tags.insertAsync({
        _id: 'tag2',
        name: 'Blue',
        postIds: ['post1', 'post2'],
      });
      let post1 = await Posts.findOneAsync('post1');
      let tag1 = await Tags.findOneAsync('tag1', { fields: { postIds: 0 } });
      let tag2 = await Tags.findOneAsync('tag2', { fields: { postIds: 0 } });
      compare(post1._tags, [tag1, tag2]);
    });
    it('parent2 should contain both children', async function () {
      let post2 = await Posts.findOneAsync('post1');
      let tag1 = await Tags.findOneAsync('tag1', { fields: { postIds: 0 } });
      let tag2 = await Tags.findOneAsync('tag2', { fields: { postIds: 0 } });
      compare(post2._tags, [tag1, tag2]);
    });
  });
  describe('Insert unlinked child', function () {
    it('cache should not contain new child', async function () {
      await Tags.insertAsync({
        _id: 'tag3',
        name: 'Green',
      });
      let post = await Posts.findOneAsync('post1');
      let tag1 = await Tags.findOneAsync('tag1', { fields: { postIds: 0 } });
      let tag2 = await Tags.findOneAsync('tag2', { fields: { postIds: 0 } });
      compare(post._tags, [tag1, tag2]);
    });
  });
  describe('Update child referenceField', function () {
    it('parent1 should now contain the child', async function () {
      await Tags.updateAsync('tag3', { $set: { postIds: ['post1', 'post2'] } });
      let post1 = await Posts.findOneAsync('post1');
      let tag1 = await Tags.findOneAsync('tag1', { fields: { postIds: 0 } });
      let tag2 = await Tags.findOneAsync('tag2', { fields: { postIds: 0 } });
      let tag3 = await Tags.findOneAsync('tag3', { fields: { postIds: 0 } });
      compare(post1._tags, [tag1, tag2, tag3]);
    });
    it('parent2 should now contain the child', async function () {
      let post2 = await Posts.findOneAsync('post2');
      let tag1 = await Tags.findOneAsync('tag1', { fields: { postIds: 0 } });
      let tag2 = await Tags.findOneAsync('tag2', { fields: { postIds: 0 } });
      let tag3 = await Tags.findOneAsync('tag3', { fields: { postIds: 0 } });
      compare(post2._tags, [tag1, tag2, tag3]);
    });
  });
  describe('Update child referenceField', function () {
    it('parent1 should contain updated children', async function () {
      await Tags.find().forEachAsync(async (tag) => {
        await Tags.updateAsync(tag._id, {
          $set: { name: 'color-' + tag.name },
        });
      });
      let post1 = await Posts.findOneAsync('post1');
      let tag1 = await Tags.findOneAsync('tag1', { fields: { postIds: 0 } });
      let tag2 = await Tags.findOneAsync('tag2', { fields: { postIds: 0 } });
      let tag3 = await Tags.findOneAsync('tag3', { fields: { postIds: 0 } });
      compare(post1._tags, [tag1, tag2, tag3]);
    });
    it('parent2 should contain updated children', async function () {
      let post2 = await Posts.findOneAsync('post2');
      let tag1 = await Tags.findOneAsync('tag1', { fields: { postIds: 0 } });
      let tag2 = await Tags.findOneAsync('tag2', { fields: { postIds: 0 } });
      let tag3 = await Tags.findOneAsync('tag3', { fields: { postIds: 0 } });
      compare(post2._tags, [tag1, tag2, tag3]);
    });
  });
  describe('Remove child', function () {
    it('parent1 should only contain remaining children', async function () {
      await Tags.removeAsync('tag1');
      let post1 = await Posts.findOneAsync('post1');
      let tag2 = await Tags.findOneAsync('tag2', { fields: { postIds: 0 } });
      let tag3 = await Tags.findOneAsync('tag3', { fields: { postIds: 0 } });
      compare(post1._tags, [tag2, tag3]);
    });
    it('parent2 should only contain remaining children', async function () {
      let post2 = await Posts.findOneAsync('post2');
      let tag2 = await Tags.findOneAsync('tag2', { fields: { postIds: 0 } });
      let tag3 = await Tags.findOneAsync('tag3', { fields: { postIds: 0 } });
      compare(post2._tags, [tag2, tag3]);
    });
  });
  describe('Remove parent2 from child referenceField', function () {
    it('parent1 should still contain child', async function () {
      await Tags.updateAsync('tag3', { $pull: { postIds: 'post2' } });
      let post1 = await Posts.findOneAsync('post1');
      let tag2 = await Tags.findOneAsync('tag2', { fields: { postIds: 0 } });
      let tag3 = await Tags.findOneAsync('tag3', { fields: { postIds: 0 } });
      compare(post1._tags, [tag2, tag3]);
    });
    it('parent2 should not contain child', async function () {
      let post2 = await Posts.findOneAsync('post2');
      let tag2 = await Tags.findOneAsync('tag2', { fields: { postIds: 0 } });
      compare(post2._tags, [tag2]);
    });
  });
  describe('Insert another parent', function () {
    it('new parent should contain all children', async function () {
      await Tags.updateAsync(
        {},
        { $push: { postIds: 'post5' } },
        { multi: true },
      );
      await Posts.insertAsync({
        _id: 'post5',
      });
      let post = await Posts.findOneAsync('post5');
      let tags = await Tags.find({}, { fields: { postIds: 0 } }).fetchAsync();
      compare(post._tags, tags);
    });
  });
});

describe('cacheCount', function () {
  describe('Insert child matching filter', function () {
    it('unfiltered count should be 1', async function () {
      await Likes.insertAsync({
        _id: 'like1',
        postId: 'post1',
        country: 'Sweden',
      });
      let post = await Posts.findOneAsync('post1');
      assert.strictEqual(post._likes.all, 1);
    });
    it('filtered count should be 1', async function () {
      let post = await Posts.findOneAsync('post1');
      assert.strictEqual(post._likes.sweden, 1);
    });
  });
  describe('Insert child not matching filter', function () {
    it('unfiltered count should be 2', async function () {
      await Likes.insertAsync({
        _id: 'like2',
        postId: 'post1',
        country: 'Norway',
      });
      let post = await Posts.findOneAsync('post1');
      assert.strictEqual(post._likes.all, 2);
    });
    it('filtered count should be 1', async function () {
      let post = await Posts.findOneAsync('post1');
      assert.strictEqual(post._likes.sweden, 1);
    });
  });
  describe('Insert new parent', function () {
    it('unfiltered count should be 2', async function () {
      await Likes.insertAsync({
        _id: 'like3',
        postId: 'post6',
        country: 'Sweden',
      });
      await Likes.insertAsync({
        _id: 'like4',
        postId: 'post6',
      });
      await Posts.insertAsync({ _id: 'post6' });
      let post = await Posts.findOneAsync('post6');
      assert.strictEqual(post._likes.all, 2);
    });
    it('filtered count should be 1', async function () {
      let post = await Posts.findOneAsync('post6');
      assert.strictEqual(post._likes.sweden, 1);
    });
  });
  describe('Remove child not matching filter', function () {
    it('unfiltered count should be 1', async function () {
      await Likes.removeAsync('like2');
      let post = await Posts.findOneAsync('post1');
      assert.strictEqual(post._likes.all, 1);
    });
    it('filtered count should be 1', async function () {
      let post = await Posts.findOneAsync('post1');
      assert.strictEqual(post._likes.sweden, 1);
    });
  });
  describe('Remove child matching filter', function () {
    it('unfiltered count should be 1', async function () {
      await Likes.removeAsync('like1');
      let post = await Posts.findOneAsync('post1');
      assert.strictEqual(post._likes.all, 0);
    });
    it('filtered count should be 1', async function () {
      let post = await Posts.findOneAsync('post1');
      assert.strictEqual(post._likes.sweden, 0);
    });
  });
});

describe('cacheField', function () {
  describe('Insert document', function () {
    it('default transform field should be correct', async function (done) {
      await Users.insertAsync({
        _id: 'simon',
        username: 'Simon89',
        profile: {
          first_name: 'Simon',
          last_name: 'Herteby',
        },
      });
      Meteor.setTimeout(async function () {
        let user = await Users.findOneAsync('simon');
        try {
          assert.strictEqual(user._defaultTransform, 'Simon89, Simon, Herteby');
          done();
        } catch (err) {
          done(err);
        }
      }, 100);
    });
    it('custom transform field should be correct', function (done) {
      Meteor.setTimeout(async function () {
        let user = await Users.findOneAsync('simon');
        try {
          compare(user.nested._customTransform, [
            'Simon89',
            'Simon',
            'Herteby',
          ]);
          done();
        } catch (err) {
          done(err);
        }
      }, 100);
    });
  });
  describe('Update document', function () {
    it('default transform field should be correct', async function (done) {
      await Users.updateAsync('simon', {
        $set: { profile: { first_name: 'Karl', last_name: 'Svensson' } },
      });
      Meteor.setTimeout(async function () {
        let user = await Users.findOneAsync('simon');
        try {
          assert.strictEqual(user._defaultTransform, 'Simon89, Karl, Svensson');
          done();
        } catch (err) {
          done(err);
        }
      }, 100);
    });
    it('custom transform field should be correct', function (done) {
      Meteor.setTimeout(async function () {
        let user = await Users.findOneAsync('simon');
        try {
          compare(user.nested._customTransform, [
            'Simon89',
            'Karl',
            'Svensson',
          ]);
          done();
        } catch (err) {
          done(err);
        }
      }, 100);
    });
  });
  describe('Unset field', function () {
    it('default transform field should be correct', async function (done) {
      await Users.updateAsync('simon', { $unset: { username: 1 } });
      Meteor.setTimeout(async function () {
        let user = await Users.findOneAsync('simon');
        try {
          assert.strictEqual(user._defaultTransform, 'Karl, Svensson');
          done();
        } catch (err) {
          done(err);
        }
      }, 100);
    });
    it('custom transform field should be correct', function (done) {
      Meteor.setTimeout(async function () {
        let user = await Users.findOneAsync('simon');
        try {
          compare(user.nested._customTransform, [null, 'Karl', 'Svensson']);
          done();
        } catch (err) {
          done(err);
        }
      }, 100);
    });
  });
  describe('Unset nested field', function () {
    it('default transform field should be correct', async function (done) {
      await Users.updateAsync('simon', { $unset: { 'profile.first_name': 1 } });
      Meteor.setTimeout(async function () {
        let user = await Users.findOneAsync('simon');
        try {
          assert.strictEqual(user._defaultTransform, 'Svensson');
          done();
        } catch (err) {
          done(err);
        }
      }, 100);
    });
    it('custom transform field should be correct', function (done) {
      Meteor.setTimeout(async function () {
        let user = await Users.findOneAsync('simon');
        try {
          compare(user.nested._customTransform, [null, null, 'Svensson']);
          done();
        } catch (err) {
          done(err);
        }
      }, 100);
    });
  });
});

//Run the same tests but with nested fields

//This needs to be put in a test due to async tests
describe('Prepare for next tests', function () {
  it('clear collections', async function () {
    await Posts.removeAsync({});
    await Comments.removeAsync({});
    await Users.removeAsync({});
    await Images.removeAsync({});
    await Tags.removeAsync({});
    await Likes.removeAsync({});
  });
  it('set up caches', function () {
    Posts.cache({
      type: 'one',
      collection: Users,
      cacheField: 'caches._author',
      referenceField: 'nested.authorId',
      fields: {
        username: 1,
        profile: {
          first_name: 1,
          last_name: 1,
        },
      },
    });
    Posts.cache({
      type: 'inversed',
      collection: Comments,
      cacheField: 'caches._comments',
      referenceField: 'nested.postId',
      fields: { message: 1 },
    });
    Posts.cache({
      type: 'many',
      collection: Images,
      cacheField: 'caches._images',
      referenceField: 'nested.images:_id',
      fields: { filename: 1 },
    });
    Posts.cache({
      type: 'many-inversed',
      collection: Tags,
      cacheField: 'caches._tags',
      referenceField: 'nested.postIds:_id',
      fields: { name: 1 },
    });
    Posts.cacheCount({
      collection: Likes,
      cacheField: 'caches._likes.all',
      referenceField: 'nested.postId',
    });
    Posts.cacheCount({
      collection: Likes,
      cacheField: 'caches._likes.sweden',
      referenceField: 'nested.postId',
      selector: { country: 'Sweden' },
    });
  });
});

describe('Same tests with nested referenceFields and cacheFields', function () {
  describe('Insert parent - no children', function () {
    it('one cache should not exist', async function () {
      await Posts.insertAsync({
        _id: 'post1',
        nested: {
          authorId: 'user1',
          images: [{ _id: 'dog' }, { _id: 'cat' }],
        },
      });
      let post = await Posts.findOneAsync('post1');
      assert.isUndefined(post.caches._author);
    });
    it('many cache should be empty array', async function () {
      let post = await Posts.findOneAsync('post1');
      assert.isArray(post.caches._images);
      assert.strictEqual(post.caches._images.length, 0);
    });
    it('inverse cache should be empty array', async function () {
      let post = await Posts.findOneAsync('post1');
      assert.isArray(post.caches._comments);
      assert.strictEqual(post.caches._comments.length, 0);
    });
    it('many-inverse cache should be empty array', async function () {
      let post = await Posts.findOneAsync('post1');
      assert.isArray(post.caches._tags);
      assert.strictEqual(post.caches._tags.length, 0);
    });
  });
  describe('Type: one', function () {
    describe('Insert child', function () {
      it('child should be deeply equal except _id', async function () {
        await Users.insertAsync({
          _id: 'user1',
          username: 'Simon',
          profile: {
            first_name: 'Simon',
            last_name: 'Herteby',
          },
        });
        let post = await Posts.findOneAsync('post1');
        let user = await Users.findOneAsync('user1', {
          fields: { _id: 0, username: 1, profile: 1 },
        });
        compare(post.caches._author, user);
      });
    });
    describe('Update child', function () {
      it('cache should have the new values', async function () {
        await Users.updateAsync('user1', {
          $set: { 'profile.last_name': 'Svensson' },
        });
        let post = await Posts.findOneAsync('post1');
        let user = await Users.findOneAsync('user1', {
          fields: { _id: 0, username: 1, profile: 1 },
        });
        compare(post.caches._author, user);
      });
    });

    describe('Update parent referenceField', function () {
      it('cache should reflect the new child', async function () {
        await Users.insertAsync({
          _id: 'user2',
          username: 'Karl',
          profile: {
            first_name: 'Karl',
            last_name: 'Henriksson',
          },
        });
        await Posts.updateAsync('post1', {
          $set: { 'nested.authorId': 'user2' },
        });
        let post = await Posts.findOneAsync('post1');
        let user = await Users.findOneAsync('user2', {
          fields: { _id: 0, username: 1, profile: 1 },
        });
        compare(post.caches._author, user);
      });
    });
    describe('Remove child', function () {
      it('cache should be undefined', async function () {
        await Users.removeAsync('user2');
        let post = await Posts.findOneAsync('post1');
        assert.isUndefined(post.caches._author);
      });
    });
    describe('Insert another parent', function () {
      it('new parent should have child in cache', async function () {
        await Posts.insertAsync({
          _id: 'post2',
          nested: { authorId: 'user1' },
        });
        let post = await Posts.findOneAsync('post2');
        let user = await Users.findOneAsync('user1', {
          fields: { _id: 0, username: 1, profile: 1 },
        });
        compare(post.caches._author, user);
      });
    });
  });

  describe('Type: many', function () {
    describe('Insert child', function () {
      it('cache should contain child', async function () {
        await Images.insertAsync({
          _id: 'cat',
          filename: 'cat.jpg',
        });
        let post = await Posts.findOneAsync('post1');
        let image = await Images.findOneAsync('cat');
        compare(post.caches._images, [image]);
      });
    });
    describe('Insert another child', function () {
      it('cache should contain both children', async function () {
        await Images.insertAsync({
          _id: 'dog',
          filename: 'dog.png',
        });
        let post = await Posts.findOneAsync('post1');
        let cat = await Images.findOneAsync('cat');
        let dog = await Images.findOneAsync('dog');
        compare(post.caches._images, [cat, dog]);
      });
    });
    describe('Update children', function () {
      it('cache should contain both updated children', async function () {
        await Images.find().forEachAsync(async (image) => {
          await Images.updateAsync(image._id, {
            $set: { filename: image.filename + '.zip' },
          });
        });
        let post = await Posts.findOneAsync('post1');
        let cat = await Images.findOneAsync('cat');
        let dog = await Images.findOneAsync('dog');
        compare(post.caches._images, [cat, dog]);
      });
    });
    describe('Remove child', function () {
      it('cache should only contain the remaining child', async function () {
        await Images.removeAsync('cat');
        let post = await Posts.findOneAsync('post1');
        let dog = await Images.findOneAsync('dog');
        compare(post.caches._images, [dog]);
      });
    });
    describe('Insert unlinked child', function () {
      it('cache should not contain the inserted child', async function () {
        await Images.insertAsync({
          _id: 'horse',
          filename: 'horse.gif',
        });
        let post = await Posts.findOneAsync('post1');
        let dog = await Images.findOneAsync('dog');
        compare(post.caches._images, [dog]);
      });
    });
    describe('Add child to parent referenceField', function () {
      it('cache should contain both children', async function () {
        await Posts.updateAsync('post1', {
          $push: { 'nested.images': { _id: 'horse' } },
        });
        let post = await Posts.findOneAsync('post1');
        let horse = await Images.findOneAsync('horse');
        let dog = await Images.findOneAsync('dog');
        compare(post.caches._images, [dog, horse]);
      });
    });
    describe('Remove child from parent referenceField', function () {
      it('cache should only contain remaining child', async function () {
        await Posts.updateAsync('post1', {
          $pull: { 'nested.images': { _id: 'dog' } },
        });
        let post = await Posts.findOneAsync('post1');
        let horse = await Images.findOneAsync('horse');
        compare(post.caches._images, [horse]);
      });
    });
    describe('Insert another parent', function () {
      it('cache should have correct children', async function () {
        await Posts.insertAsync({
          _id: 'post3',
          nested: {
            images: [{ _id: 'dog' }, { _id: 'horse' }],
          },
        });
        let post = await Posts.findOneAsync('post3');
        let dog = await Images.findOneAsync('dog');
        let horse = await Images.findOneAsync('horse');
        compare(post.caches._images, [dog, horse]);
      });
    });
  });

  describe('Type: inversed', function () {
    describe('Insert child', function () {
      it('cache should contain child', async function () {
        await Comments.insertAsync({
          _id: 'comment1',
          message: 'Hello world!',
          nested: { postId: 'post1' },
        });
        let post = await Posts.findOneAsync('post1');
        let comment = await Comments.findOneAsync('comment1', {
          fields: { nested: 0 },
        });
        compare(post.caches._comments, [comment]);
      });
    });
    describe('Insert another child', function () {
      it('cache should contain both children', async function () {
        await Comments.insertAsync({
          _id: 'comment2',
          message: 'Hello world!',
          nested: { postId: 'post1' },
        });
        let post = await Posts.findOneAsync('post1');
        let comment1 = await Comments.findOneAsync('comment1', {
          fields: { nested: 0 },
        });
        let comment2 = await Comments.findOneAsync('comment2', {
          fields: { nested: 0 },
        });
        compare(post.caches._comments, [comment1, comment2]);
      });
    });
    describe('Insert unlinked child', function () {
      it('cache should not contain new child', async function () {
        await Comments.insertAsync({
          _id: 'comment3',
          message: 'Hello world again!',
        });
        let post = await Posts.findOneAsync('post1');
        let comment1 = await Comments.findOneAsync('comment1', {
          fields: { nested: 0 },
        });
        let comment2 = await Comments.findOneAsync('comment2', {
          fields: { nested: 0 },
        });
        compare(post.caches._comments, [comment1, comment2]);
      });
    });
    describe('Update child referenceField', function () {
      it('cache should contain new and previous children', async function () {
        await Comments.updateAsync('comment3', {
          $set: { 'nested.postId': 'post1' },
        });
        let post = await Posts.findOneAsync('post1');
        let comment1 = await Comments.findOneAsync('comment1', {
          fields: { nested: 0 },
        });
        let comment2 = await Comments.findOneAsync('comment2', {
          fields: { nested: 0 },
        });
        let comment3 = await Comments.findOneAsync('comment3', {
          fields: { nested: 0 },
        });
        compare(post.caches._comments, [comment1, comment2, comment3]);
      });
    });
    describe('Update children', function () {
      it('cache should contain updated children', async function () {
        await Comments.updateAsync(
          {},
          { $set: { message: 'Goodbye world!' } },
          { multi: true },
        );
        let post = await Posts.findOneAsync('post1');
        let comment1 = await Comments.findOneAsync('comment1', {
          fields: { nested: 0 },
        });
        let comment2 = await Comments.findOneAsync('comment2', {
          fields: { nested: 0 },
        });
        let comment3 = await Comments.findOneAsync('comment3', {
          fields: { nested: 0 },
        });
        compare(post.caches._comments, [comment1, comment2, comment3]);
      });
    });
    describe('Remove child', function () {
      it('cache should only contain remaining children', async function () {
        await Comments.removeAsync('comment2');
        let post = await Posts.findOneAsync('post1');
        let comment1 = await Comments.findOneAsync('comment1', {
          fields: { nested: 0 },
        });
        let comment3 = await Comments.findOneAsync('comment3', {
          fields: { nested: 0 },
        });
        compare(post.caches._comments, [comment1, comment3]);
      });
    });
    describe('Remove parent from child referenceField', function () {
      it('cache should only contain remaining child', async function () {
        await Comments.updateAsync('comment3', {
          $unset: { 'nested.postId': 1 },
        });
        let post = await Posts.findOneAsync('post1');
        let comment1 = await Comments.findOneAsync('comment1', {
          fields: { nested: 0 },
        });
        compare(post.caches._comments, [comment1]);
      });
    });
    describe('Insert another parent', function () {
      it('cache should contain all children', async function () {
        await Comments.updateAsync(
          {},
          { $set: { 'nested.postId': 'post4' } },
          { multi: true },
        );
        await Posts.insertAsync({
          _id: 'post4',
        });
        let post = await Posts.findOneAsync('post4');
        let comments = await Comments.find(
          {},
          { fields: { nested: 0 } },
        ).fetchAsync();
        compare(post.caches._comments, comments);
      });
    });
  });

  describe('Type: many-inversed', function () {
    describe('Insert child', function () {
      it('parent1 should contain child', async function () {
        await Tags.insertAsync({
          _id: 'tag1',
          name: 'Red',
          nested: { postIds: [{ _id: 'post1' }, { _id: 'post2' }] },
        });
        let post1 = await Posts.findOneAsync('post1');
        let tag = await Tags.findOneAsync('tag1', { fields: { nested: 0 } });
        compare(post1.caches._tags, [tag]);
      });
      it('parent2 should contain child', async function () {
        let post2 = await Posts.findOneAsync('post2');
        let tag = await Tags.findOneAsync('tag1', { fields: { nested: 0 } });
        compare(post2.caches._tags, [tag]);
      });
      it('parent3 should not contain child', async function () {
        let post3 = await Posts.findOneAsync('post3');
        compare(post3.caches._tags, []);
      });
    });
    describe('Insert another child', function () {
      it('parent1 should contain both children', async function () {
        await Tags.insertAsync({
          _id: 'tag2',
          name: 'Blue',
          nested: { postIds: [{ _id: 'post1' }, { _id: 'post2' }] },
        });
        let post1 = await Posts.findOneAsync('post1');
        let tag1 = await Tags.findOneAsync('tag1', { fields: { nested: 0 } });
        let tag2 = await Tags.findOneAsync('tag2', { fields: { nested: 0 } });
        compare(post1.caches._tags, [tag1, tag2]);
      });
      it('parent2 should contain both children', async function () {
        let post2 = await Posts.findOneAsync('post2');
        let tag1 = await Tags.findOneAsync('tag1', { fields: { nested: 0 } });
        let tag2 = await Tags.findOneAsync('tag2', { fields: { nested: 0 } });
        compare(post2.caches._tags, [tag1, tag2]);
      });
    });
    describe('Insert unlinked child', function () {
      it('cache should not contain new child', async function () {
        await Tags.insertAsync({
          _id: 'tag3',
          name: 'Green',
        });
        let post = await Posts.findOneAsync('post1');
        let tag1 = await Tags.findOneAsync('tag1', { fields: { nested: 0 } });
        let tag2 = await Tags.findOneAsync('tag2', { fields: { nested: 0 } });
        compare(post.caches._tags, [tag1, tag2]);
      });
    });
    describe('Update child referenceField', function () {
      it('parent1 should now contain the child', async function () {
        await Tags.updateAsync('tag3', {
          $set: { 'nested.postIds': [{ _id: 'post1' }, { _id: 'post2' }] },
        });
        let post1 = await Posts.findOneAsync('post1');
        let tag1 = await Tags.findOneAsync('tag1', { fields: { nested: 0 } });
        let tag2 = await Tags.findOneAsync('tag2', { fields: { nested: 0 } });
        let tag3 = await Tags.findOneAsync('tag3', { fields: { nested: 0 } });
        compare(post1.caches._tags, [tag1, tag2, tag3]);
      });
      it('parent2 should now contain the child', async function () {
        let post2 = await Posts.findOneAsync('post2');
        let tag1 = await Tags.findOneAsync('tag1', { fields: { nested: 0 } });
        let tag2 = await Tags.findOneAsync('tag2', { fields: { nested: 0 } });
        let tag3 = await Tags.findOneAsync('tag3', { fields: { nested: 0 } });
        compare(post2.caches._tags, [tag1, tag2, tag3]);
      });
    });
    describe('Update children', function () {
      it('parent1 should contain updated children', async function () {
        await Tags.find().forEachAsync(async (tag) => {
          await Tags.updateAsync(tag._id, {
            $set: { name: 'color-' + tag.name },
          });
        });
        let post1 = await Posts.findOneAsync('post1');
        let tag1 = await Tags.findOneAsync('tag1', { fields: { nested: 0 } });
        let tag2 = await Tags.findOneAsync('tag2', { fields: { nested: 0 } });
        let tag3 = await Tags.findOneAsync('tag3', { fields: { nested: 0 } });
        compare(post1.caches._tags, [tag1, tag2, tag3]);
      });
      it('parent2 should contain updated children', async function () {
        let post2 = await Posts.findOneAsync('post2');
        let tag1 = await Tags.findOneAsync('tag1', { fields: { nested: 0 } });
        let tag2 = await Tags.findOneAsync('tag2', { fields: { nested: 0 } });
        let tag3 = await Tags.findOneAsync('tag3', { fields: { nested: 0 } });
        compare(post2.caches._tags, [tag1, tag2, tag3]);
      });
    });
    describe('Remove child', function () {
      it('parent1 should only contain remaining children', async function () {
        await Tags.removeAsync('tag1');
        let post1 = await Posts.findOneAsync('post1');
        let tag2 = await Tags.findOneAsync('tag2', { fields: { nested: 0 } });
        let tag3 = await Tags.findOneAsync('tag3', { fields: { nested: 0 } });
        compare(post1.caches._tags, [tag2, tag3]);
      });
      it('parent2 should only contain remaining children', async function () {
        let post2 = await Posts.findOneAsync('post2');
        let tag2 = await Tags.findOneAsync('tag2', { fields: { nested: 0 } });
        let tag3 = await Tags.findOneAsync('tag3', { fields: { nested: 0 } });
        compare(post2.caches._tags, [tag2, tag3]);
      });
    });
    describe('Remove parent2 from child referenceField', function () {
      it('parent1 should still contain child', async function () {
        await Tags.updateAsync('tag3', {
          $pull: { 'nested.postIds': { _id: 'post2' } },
        });
        let post1 = await Posts.findOneAsync('post1');
        let tag2 = await Tags.findOneAsync('tag2', { fields: { nested: 0 } });
        let tag3 = await Tags.findOneAsync('tag3', { fields: { nested: 0 } });
        compare(post1.caches._tags, [tag2, tag3]);
      });
      it('parent2 should not contain child', async function () {
        let post2 = await Posts.findOneAsync('post2');
        let tag2 = await Tags.findOneAsync('tag2', { fields: { nested: 0 } });
        compare(post2.caches._tags, [tag2]);
      });
    });
    describe('Insert another parent', function () {
      it('new parent should contain all children', async function () {
        await Tags.updateAsync(
          {},
          { $push: { 'nested.postIds': { _id: 'post5' } } },
          { multi: true },
        );
        await Posts.insertAsync({
          _id: 'post5',
        });
        let post = await Posts.findOneAsync('post5');
        let tags = await Tags.find({}, { fields: { nested: 0 } }).fetchAsync();
        compare(post.caches._tags, tags);
      });
    });
  });
  describe('cacheCount', function () {
    describe('Insert child matching filter', function () {
      it('unfiltered count should be 1', async function () {
        await Likes.insertAsync({
          _id: 'like1',
          nested: { postId: 'post1' },
          country: 'Sweden',
        });
        let post = await Posts.findOneAsync('post1');
        assert.strictEqual(post.caches._likes.all, 1);
      });
      it('filtered count should be 1', async function () {
        let post = await Posts.findOneAsync('post1');
        assert.strictEqual(post.caches._likes.sweden, 1);
      });
    });
    describe('Insert child not matching filter', function () {
      it('unfiltered count should be 2', async function () {
        await Likes.insertAsync({
          _id: 'like2',
          nested: { postId: 'post1' },
          country: 'Norway',
        });
        let post = await Posts.findOneAsync('post1');
        assert.strictEqual(post.caches._likes.all, 2);
      });
      it('filtered count should be 1', async function () {
        let post = await Posts.findOneAsync('post1');
        assert.strictEqual(post.caches._likes.sweden, 1);
      });
    });
    describe('Insert new parent', function () {
      it('unfiltered count should be 2', async function () {
        await Likes.insertAsync({
          _id: 'like3',
          nested: { postId: 'post6' },
          country: 'Sweden',
        });
        await Likes.insertAsync({
          _id: 'like4',
          nested: { postId: 'post6' },
        });
        await Posts.insertAsync({ _id: 'post6' });
        let post = await Posts.findOneAsync('post6');
        assert.strictEqual(post.caches._likes.all, 2);
      });
      it('filtered count should be 1', async function () {
        let post = await Posts.findOneAsync('post6');
        assert.strictEqual(post.caches._likes.sweden, 1);
      });
    });
    describe('Remove child not matching filter', function () {
      it('unfiltered count should be 1', async function () {
        await Likes.removeAsync('like2');
        let post = await Posts.findOneAsync('post1');
        assert.strictEqual(post.caches._likes.all, 1);
      });
      it('filtered count should be 1', async function () {
        let post = await Posts.findOneAsync('post1');
        assert.strictEqual(post.caches._likes.sweden, 1);
      });
    });
    describe('Remove child matching filter', function () {
      it('unfiltered count should be 1', async function () {
        await Likes.removeAsync('like1');
        let post = await Posts.findOneAsync('post1');
        assert.strictEqual(post.caches._likes.all, 0);
      });
      it('filtered count should be 1', async function () {
        let post = await Posts.findOneAsync('post1');
        assert.strictEqual(post.caches._likes.sweden, 0);
      });
    });
  });
});

describe('Recursive caching', function () {
  it('clear collections', async function () {
    await Customers.removeAsync({});
    await Bills.removeAsync({});
    await Items.removeAsync({});
  });
  it('clear hooks', function () {
    _.each([Customers, Bills, Items], (collection) => {
      collection._hooks.insert.after = [];
      collection._hooks.update.after = [];
      collection._hooks.remove.after = [];
    });
  });
  it('set up caches', function () {
    //Option one
    Customers.cache({
      cacheField: '_bills',
      collection: Bills,
      type: 'inverse',
      referenceField: 'customerId',
      fields: ['_sum', '_items'],
    });

    Bills.cache({
      cacheField: '_items',
      collection: Items,
      type: 'many',
      referenceField: 'itemIds',
      fields: ['name', 'price'],
    });
    //Option two
    Customers.cache({
      cacheField: '_bills2',
      collection: Bills,
      type: 'inverse',
      referenceField: 'customerId',
      fields: ['itemIds', '_sum'],
    });
    Customers.cache({
      cacheField: '_items',
      collection: Items,
      type: 'many',
      referenceField: '_bills2:itemIds',
      fields: ['name', 'price'],
    });

    Bills.cacheField({
      fields: ['_items'],
      cacheField: '_sum',
      transform(doc) {
        let price = _.sum(_.map(doc._items, 'price'));
        return price;
      },
    });
  });
  describe('Insert documents', function () {
    it('All caches should have correct values', async function (done) {
      await Customers.insertAsync({
        _id: 'customer1',
      });
      await Bills.insertAsync({
        _id: 'bill1',
        customerId: 'customer1',
        itemIds: ['item1', 'item2'],
      });
      await Bills.insertAsync({
        _id: 'bill2',
        customerId: 'customer1',
        itemIds: ['item3', 'item4'],
      });
      await Items.insertAsync({
        _id: 'item1',
        name: 'Muffin',
        price: 30,
      });
      await Items.insertAsync({
        _id: 'item2',
        name: 'Coffee',
        price: 25,
      });
      await Items.insertAsync({
        _id: 'item3',
        name: 'Cake',
        price: 40,
      });
      await Items.insertAsync({
        _id: 'item4',
        name: 'Tea',
        price: 25,
      });
      let expected = {
        _bills: [
          {
            _id: 'bill1',
            _items: [
              { _id: 'item1', name: 'Muffin', price: 30 },
              { _id: 'item2', name: 'Coffee', price: 25 },
            ],
            _sum: 55,
          },
          {
            _id: 'bill2',
            _items: [
              { _id: 'item3', name: 'Cake', price: 40 },
              { _id: 'item4', name: 'Tea', price: 25 },
            ],
            _sum: 65,
          },
        ],
        _bills2: [
          { _id: 'bill1', _sum: 55, itemIds: ['item1', 'item2'] },
          { _id: 'bill2', _sum: 65, itemIds: ['item3', 'item4'] },
        ],
        _items: [
          { _id: 'item1', name: 'Muffin', price: 30 },
          { _id: 'item2', name: 'Coffee', price: 25 },
          { _id: 'item3', name: 'Cake', price: 40 },
          { _id: 'item4', name: 'Tea', price: 25 },
        ],
      };
      Meteor.setTimeout(async function () {
        let customer = await Customers.findOneAsync('customer1', {
          fields: { _id: 0 },
        });
        try {
          compare(expected, customer);
          done();
        } catch (err) {
          done(err);
        }
      }, 100);
    });
  });
  describe('update a child', function () {
    it('all caches should be updated with correct values', async function (done) {
      await Bills.updateAsync('bill1', { $push: { itemIds: 'item3' } });
      let expected = {
        _bills: [
          {
            _id: 'bill1',
            _items: [
              { _id: 'item1', name: 'Muffin', price: 30 },
              { _id: 'item2', name: 'Coffee', price: 25 },
              { _id: 'item3', name: 'Cake', price: 40 },
            ],
            _sum: 95,
          },
          {
            _id: 'bill2',
            _items: [
              { _id: 'item3', name: 'Cake', price: 40 },
              { _id: 'item4', name: 'Tea', price: 25 },
            ],
            _sum: 65,
          },
        ],
        _bills2: [
          { _id: 'bill1', _sum: 95, itemIds: ['item1', 'item2', 'item3'] },
          { _id: 'bill2', _sum: 65, itemIds: ['item3', 'item4'] },
        ],
        _items: [
          { _id: 'item1', name: 'Muffin', price: 30 },
          { _id: 'item2', name: 'Coffee', price: 25 },
          { _id: 'item3', name: 'Cake', price: 40 },
          { _id: 'item4', name: 'Tea', price: 25 },
        ],
      };
      Meteor.setTimeout(async function () {
        let customer = await Customers.findOneAsync('customer1', {
          fields: { _id: 0 },
        });
        try {
          compare(customer, expected);
          done();
        } catch (err) {
          done(err);
        }
      }, 100);
    });
  });
  describe('update a grandchild', function () {
    it('all caches should be updated with correct values', async function (done) {
      await Items.updateAsync('item1', { $set: { price: 15 } });
      let expected = {
        _bills: [
          {
            _id: 'bill1',
            _items: [
              { _id: 'item1', name: 'Muffin', price: 15 },
              { _id: 'item2', name: 'Coffee', price: 25 },
              { _id: 'item3', name: 'Cake', price: 40 },
            ],
            _sum: 80,
          },
          {
            _id: 'bill2',
            _items: [
              { _id: 'item3', name: 'Cake', price: 40 },
              { _id: 'item4', name: 'Tea', price: 25 },
            ],
            _sum: 65,
          },
        ],
        _bills2: [
          { _id: 'bill1', _sum: 80, itemIds: ['item1', 'item2', 'item3'] },
          { _id: 'bill2', _sum: 65, itemIds: ['item3', 'item4'] },
        ],
        _items: [
          { _id: 'item1', name: 'Muffin', price: 15 },
          { _id: 'item2', name: 'Coffee', price: 25 },
          { _id: 'item3', name: 'Cake', price: 40 },
          { _id: 'item4', name: 'Tea', price: 25 },
        ],
      };
      Meteor.setTimeout(async function () {
        let customer = await Customers.findOneAsync('customer1', {
          fields: { _id: 0 },
        });
        try {
          compare(customer, expected);
          done();
        } catch (err) {
          done(err);
        }
      }, 100);
    });
  });
  describe('remove a grandchild', function (done) {
    it('all caches should be updated with correct values', async function (done) {
      await Items.removeAsync('item2');
      let expected = {
        _bills: [
          {
            _id: 'bill1',
            _items: [
              { _id: 'item1', name: 'Muffin', price: 15 },
              { _id: 'item3', name: 'Cake', price: 40 },
            ],
            _sum: 55,
          },
          {
            _id: 'bill2',
            _items: [
              { _id: 'item3', name: 'Cake', price: 40 },
              { _id: 'item4', name: 'Tea', price: 25 },
            ],
            _sum: 65,
          },
        ],
        _bills2: [
          { _id: 'bill1', _sum: 55, itemIds: ['item1', 'item2', 'item3'] }, //item2 will still be in itemIds
          { _id: 'bill2', _sum: 65, itemIds: ['item3', 'item4'] },
        ],
        _items: [
          { _id: 'item1', name: 'Muffin', price: 15 },
          { _id: 'item3', name: 'Cake', price: 40 },
          { _id: 'item4', name: 'Tea', price: 25 },
        ],
      };
      Meteor.setTimeout(async function () {
        let customer = await Customers.findOneAsync('customer1', {
          fields: { _id: 0 },
        });
        try {
          compare(customer, expected);
          done();
        } catch (err) {
          done(err);
        }
      }, 100);
    });
  });
  describe('add a grandchild', function () {
    it('all caches should be updated with correct values', async function (done) {
      await Items.insertAsync({
        _id: 'item2',
        name: 'Espresso',
        price: 35,
      });
      let expected = {
        _bills: [
          {
            _id: 'bill1',
            _items: [
              { _id: 'item1', name: 'Muffin', price: 15 },
              { _id: 'item3', name: 'Cake', price: 40 },
              { _id: 'item2', name: 'Espresso', price: 35 },
            ],
            _sum: 90,
          },
          {
            _id: 'bill2',
            _items: [
              { _id: 'item3', name: 'Cake', price: 40 },
              { _id: 'item4', name: 'Tea', price: 25 },
            ],
            _sum: 65,
          },
        ],
        _bills2: [
          { _id: 'bill1', _sum: 90, itemIds: ['item1', 'item2', 'item3'] }, //item2 will still be in itemIds
          { _id: 'bill2', _sum: 65, itemIds: ['item3', 'item4'] },
        ],
        _items: [
          { _id: 'item1', name: 'Muffin', price: 15 },
          { _id: 'item2', name: 'Espresso', price: 35 },
          { _id: 'item3', name: 'Cake', price: 40 },
          { _id: 'item4', name: 'Tea', price: 25 },
        ],
      };
      Meteor.setTimeout(async function () {
        let customer = await Customers.findOneAsync('customer1', {
          fields: { _id: 0 },
        });
        try {
          compare(customer, expected);
          done();
        } catch (err) {
          done(err);
        }
      }, 100);
    });
  });
  describe('remove a child', function (done) {
    it('all caches should be updated with correct values', async function (done) {
      await Bills.removeAsync('bill1');
      let expected = {
        _bills: [
          {
            _id: 'bill2',
            _items: [
              { _id: 'item3', name: 'Cake', price: 40 },
              { _id: 'item4', name: 'Tea', price: 25 },
            ],
            _sum: 65,
          },
        ],
        _bills2: [{ _id: 'bill2', _sum: 65, itemIds: ['item3', 'item4'] }],
        _items: [
          { _id: 'item3', name: 'Cake', price: 40 },
          { _id: 'item4', name: 'Tea', price: 25 },
        ],
      };
      Meteor.setTimeout(async function () {
        let customer = await Customers.findOneAsync('customer1', {
          fields: { _id: 0 },
        });
        try {
          compare(customer, expected);
          done();
        } catch (err) {
          done(err);
        }
      }, 100);
    });
  });
});
