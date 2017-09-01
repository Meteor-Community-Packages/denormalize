# Denormalize

Simple denormalization for Meteor

```
meteor add herteby:denormalize
```

In this readme, *parent* always refers to the documents in which the cache is stored, while *child* refers to the documents that will be cached.

**Example:** You have two collections - Users and Roles. The Users store the _id of any Roles they have been assigned. If you want each User to cache information from any Roles that are assigned to it, the Users would be the *parents* and the Roles would be the *children*, and it would be either a *one* or *many* relationship, depending on if a User can have multiple Roles. If you wanted each Role to store a list of all Users which have that role, the Roles would be the *parents* and the Users would be the *children*, and it would be a *inverse* or *many-inverse* relationship.
## cache()

```javascript
ParentCollection.cache({
  type:'one',
  collection:ChildCollection,
  fields:['name','title'],
  referenceField:'childId',
  cacheField:'_cache'
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
    <td>The collection from which docs will be cached</td>
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
    <td>validate</td>
    <td>Boolean (optional)</td>
    <td>If set to true, the function will not attempt to bypass any collection2 schemas if they are defined. You must then make sure to include the cacheField in your schema.</td>
  </tr>
</table>

## cacheCount()

```javascript
ParentCollection.cacheCount({
  collection:ChildCollection,
  referenceField:'parentId',
  cacheField:'count',
  selector:{done:null, priority:{$lt:3}}
})
```

cacheCount() is for the same type of relationships as "inverse" and "many-inverse". ie. each child may contain a reference to one or more parents.

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
    <td>Selector</td>
    <td>Mongo selector (optional)</td>
    <td>Can be used to filter the counted documents. <code>[referenceField]:parent._id</code> will always be included though.</td>
  </tr>
</table>

## cacheField()

```javascript
Collection.cacheField({
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
    <td>The function used to compute the result. If not defined, the default is to return a string of all watched fields concatenated with <code>', '</code></td>
  </tr>
</table>

## Nested referenceFields
For "one" and "inverse", nested referenceFields are simply declared like `referenceField:'nested.reference.field'`

For "many" and "many-inverse", if the referenceField is an Array containing objects, a colon is used to show where the Array starts.

**Example:**
If the parent doc looks like this:
```javascript
{
  references:{
    users:[{_id:'user1'}, {_id:'user2'}]
  }
}
```
The referenceField string should be `'references.users:_id'`

## Testing the package

```
meteor test-packages packages/denormalize --driver-package=practicalmeteor:mocha
```
open localhost:3000 in your browser