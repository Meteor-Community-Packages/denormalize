# Denormalize

Simple denormalization for Meteor

- [Introduction](#introduction)
- [Collection.cache](#collectioncacheoptions)
- [Collection.cacheCount](#collectioncachecountoptions)
- [Collection.cacheField](#collectioncachefieldoptions)
- [Migration](#migration)
- [Nested referenceFields](#nested-referencefields)
- [Recursive caching](#recursive-caching)
- [When are the caches updated?](#when-are-the-caches-updated)
- [Testing the package](#testing-the-package)

## Introduction

```
meteor add herteby:denormalize
```

In this readme, *parent* always refers to the documents in which the cache is stored, while *child* refers to the documents that will be cached.

**Example:** You have two collections - Users and Roles. The Users store the _id of any Roles they have been assigned. If you want each User to cache information from any Roles that are assigned to it, the Users would be the *parents* and the Roles would be the *children*, and it would be either a *one* or *many* relationship, depending on if a User can have multiple Roles. If you wanted each Role to store a list of all Users which have that role, the Roles would be the *parents* and the Users would be the *children*, and it would be an *inverse* or *many-inverse* relationship.
## Collection.cache(options)

```javascript
Posts.cache({
  type:'one',
  collection:Meteor.users,
  fields:['username', 'profile.firstName', 'profile.lastName'],
  referenceField:'author_id',
  cacheField:'author'
})
```

<table>
  <tr>
    <th>Property</th>
    <th>Valid values</th>
    <th>Description</th>
  </tr>
  <tr>
    <td>type</td>
    <td>'one', 'many', 'inverse' or 'many-inverse'</td>
    <td>
      <div><b>one:</b> The parent stores a single child _id</div>
      <div><b>many:</b> The parent stores an array of child _ids</div>
      <div><b>inverse:</b> Each child stores a single parent _id</div>
      <div><b>many-inverse:</b> Each child stores an array of parent _ids</div>
    </td>
  </tr>
  <tr>
    <td>collection</td>
    <td>Mongo.Collection</td>
    <td>The "child collection", from which docs will be cached</td>
  </tr>
  <tr>
    <td>fields</td>
    <td>Array of Strings or Object</td>
    <td>The fields to include in the cache. It can either look like <code>['username', 'profile.email']</code> or <code>{username:1, profile:{email:1}}</code>. For "many", "inverse" and "many-inverse", _id will always be included.</td>
  </tr>
  <tr>
    <td>referenceField</td>
    <td>String</td>
    <td>For "one" and "many", the field on the parent containing _id of children. For "inverse" and "many-inverse", the field on the children containing the _id of the parent.</td>
  </tr>
  <tr>
    <td>cacheField</td>
    <td>String</td>
    <td>The field on the parent where children are cached. Can be a nested field, like <code>'caches.field'</code>, but it can not be in the same top level field as the referenceField. For <code>type:'one'</code>, cacheField will store a single child. For all others, it will store an array of children.</td>
  </tr>
  <tr>
    <td>bypassSchema</td>
    <td>Boolean (optional)</td>
    <td>If set to true, it will bypass any <a href="https://github.com/aldeed/meteor-collection2">collection2</a> schema that may exist. Otherwise you must add the cacheField to your schema.</td>
  </tr>
</table>

#### Notes and clarification:
- "one" and "inverse" are *many-to-one* relationships (with "one", a parent can only have one child, but many parents could have the same child). "many" and "many-inverse" are *many-to-many* relationships
- When `cacheField` is an array (all types except "one"), the order of the children is not guaranteed.
- When `referenceField` is an array, if it contains duplicate _ids, they will be ignored. The `cacheField` will always contain unique children.

## Collection.cacheCount(options)

```javascript
TodoLists.cacheCount({
  collection:Todos,
  referenceField:'list_id',
  cacheField:'counts.important',
  selector:{done:null, priority:{$lt:3}}
})
```

cacheCount() can be used on "inverse" and "many-inverse" relationships

<table>
  <tr>
    <th>Property</th>
    <th>Valid values</th>
    <th>Description</th>
  </tr>
  <tr>
    <td>collection</td>
    <td>Mongo.Collection</td>
    <td>The collection in which docs will be counted</td>
  </tr>
  <tr>
    <td>referenceField</td>
    <td>String</td>
    <td>The field on counted docs which must match the parent _id</td>
  </tr>
  <tr>
    <td>cacheField</td>
    <td>String</td>
    <td>The field where the count is stored. Can be a nested field like <code>'counts.all'</code></td>
  </tr>
  <tr>
    <td>selector</td>
    <td>Mongo selector (optional)</td>
    <td>Can be used to filter the counted documents. <code>[referenceField]:parent._id</code> will always be included though.</td>
  </tr>
  <tr>
    <td>bypassSchema</td>
    <td>Boolean (optional)</td>
    <td>If set to true, it will bypass any <a href="https://github.com/aldeed/meteor-collection2">collection2</a> schema that may exist. Otherwise you must add the cacheField to your schema.</td>
  </tr>
</table>

## Collection.cacheField(options)
```javascript
Meteor.users.cacheField({
  fields:['profile.firstName', 'profile.lastName'],
  cacheField:'fullname',
  transform(doc){
    return doc.profile.firstName + ' ' + doc.profile.lastName
  }
})

```
<table>
  <tr>
    <th>Property</th>
    <th>Valid values</th>
    <th>Description</th>
  </tr>
  <tr>
    <td>fields</td>
    <td>Array of Strings or Object</td>
    <td>The fields to watch for changes. It can either look like <code>['username', 'profile.email']</code> or <code>{username:1, profile:{email:1}}</code></td>
  </tr>
  <tr>
    <td>cacheField</td>
    <td>String</td>
    <td>Where the result is stored. Can be nested like <code>'computed.fullName'</code></td>
  </tr>
  <tr>
    <td>transform</td>
    <td>Function (optional)</td>
    <td>The function used to compute the result. If not defined, the default is to return a string of all watched fields concatenated with <code>', '</code><br>The document provided to the function only contains the fields specified in <code>fields</code></td>
  </tr>
  <tr>
    <td>bypassSchema</td>
    <td>Boolean (optional)</td>
    <td>If set to true, it will bypass any <a href="https://github.com/aldeed/meteor-collection2">collection2</a> schema that may exist. Otherwise you must add the cacheField to your schema.</td>
  </tr>
</table>

**Note:** The transform function could also fetch data from other collections or through HTTP if you wanted, as long as it's done synchronously.

## Migration

If you decide to add a new cache or change the cache options on a collection that already contains documents, those documents need to be updated. There are two options for this:

### migrate(collectionName, cacheField, [selector])
```javascript
import {migrate} from 'meteor/herteby:denormalize'
migrate('users', 'fullName')
migrate('users', 'fullAddress', {fullAddress:{$exists:false}})
```
This updates the specified cacheField for all documents in the collection, or all documents matching the selector. Selector can also be an _id.

### autoMigrate()
```javascript
import {autoMigrate} from 'meteor/herteby:denormalize'
autoMigrate() //should be called last in your server code, after all caches have been declared
```
When `autoMigrate()` is called, it checks all the caches you have declared against a collection (called _cacheMigrations in the DB) to see wether they need to be migrated. If any do, it will run a migration on them, and then save the options to _cacheMigrations, so that it won't run again unless you change any of the options. If you later for example decide to add another field to a cache, it will rerun automatically.

One thing it does not do is remove the old cacheField, if you were to change the name or remove the cache. That part you have to do yourself.

Note: it does not check the *documents*, it just checks each *cache declaration*, so it won't thrash your DB on server start going through millions of records (unless something needs to be updated).

## Nested referenceFields
For "one" and "inverse", nested referenceFields are simply declared like `referenceField:'nested.reference.field'`

For "many" and "many-inverse", if the referenceField is an Array containing objects, a colon is used to show where the Array starts.

#### Example:

If the parent doc looks like this:
```javascript
{
  //...
  references:{
    users:[{_id:'user1'}, {_id:'user2'}]
  }
}
```
The referenceField string should be `'references.users:_id'`

## Recursive caching

You can use the output (the `cacheField`) of one cache function as one of the fields to be cached by another cache function, or even as the referenceField. They will all be updated correctly. This way you can create "chains" connecting three or more collections.

In the examples below, all cache fields start with `_`, which may be a good convention to follow for all your caches.

#### Use cacheField() to cache the sum of all cached items from a purchase
```javascript
Bills.cacheField({
  fields:['_items'],
  cacheField:'_sum',
  transform(doc){
    return _.sum(_.map(doc._items, 'price'))
  }
})
```
#### Caching the cacheFields of another cache
```javascript
Bills.cache({
  cacheField:'_items',
  collection:Items,
  type:'many',
  referenceField:'item_ids',
  fields:['name', 'price']
})
Customers.cache({
  cacheField:'_bills',
  collection:Bills,
  type:'inverse',
  referenceField:'customer_id',
  fields:['_sum', '_items']
})
```
#### Using the cacheField of another cache as referenceField
```javascript
Customers.cache({
  cacheField:'_bills2',
  collection:Bills,
  type:'inverse',
  referenceField:'customer_id',
  fields:['item_ids', '_sum']
})
Customers.cache({
  cacheField:'_items',
  collection:Items,
  type:'many',
  referenceField:'_bills2:item_ids',
  fields:['name', 'price']
})
```

#### Incestuous relationships

With this fun title I'm simply referring to caches where the *parent* and *child* collections are the same.

```javascript
Meteor.users.cache({
  cacheField:'_friends',
  collection:Meteor.users,
  type:'many',
  referenceField:'friend_ids',
  fields:['name', 'profile.avatar']
})
```
This works fine, but there is one thing you can not do - *cache the cacheField of a document in the same collection* - in this example it would be caching the friends of a users friends. This would lead to an infinite loop and infinitely growing caches.


## When are the caches updated?

The caches for `cache()` and `cacheCount()` are updated immediately and synchronously.

```javascript
Posts.cache({
  cacheField:'_author',
  //...
})
Posts.insert({_id:'post1', author_id:'user1'})
Posts.findOne('post1')._author //will contain the cached user
```
`cache()` uses 5 hooks: parent.after.insert, parent.after.update, child.after.insert, child.after.update and child.after.remove. There are then checks done to make sure it doesn't do unnecessary updates.

Basically you should always be able to rely on the caches being updated. If they're not, that should be considered a bug.

*However*, to avoid a complicated issue with "recursive caching", the update of `cacheField()` is always deferred.

```javascript
Meteor.users.cacheField({
  fields:['address', 'postalCode', 'city'],
  cacheField:'_fullAddress',
})
Meteor.users.insert({_id:'user1', ...})
Meteor.users.findOne('user1')._fullAddress //will not contain the cached address yet
Meteor.setTimeout(()=>{
  Meteor.users.findOne('user1')._fullAddress //now it should be there
}, 50)
```

**Note:** Since this package relies on collection-hooks, it won't detect any updates you do to the DB outside of Meteor. To solve that, you can call the `migrate()` function afterwards.

## Testing the package

```
cd packages/denormalize
npm run test
```
The tests will be run in the console<br>
The package currently has over 120 tests<br>
Note: The "slowness warnings" in the results are just due to the asynchronous tests