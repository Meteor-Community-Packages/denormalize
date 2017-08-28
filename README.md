# denormalize

Simple denormalization for Meteor

```
meteor add herteby:denormalize
```

## API

```javascript
ParentCollection.cache({
  type:'single',
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
		<td>'single', 'many' or 'inversed'</td>
		<td>The type of cache.</td>
	</tr>
	<tr>
		<td>collection</td>
		<td>Mongo.Collection</td>
		<td>The collection from which docs will be cached</td>
	</tr>
	<tr>
		<td>fields</td>
		<td>Array of Strings or Object</td>
		<td>The fields to include in the cache. It can either look like <code>['username', 'profile.email']</code> or <code>{username:1, profile:{email:1}}. For "many" and "inversed", _id will always be included.</code></td>
	</tr>
	<tr>
		<td>referenceField</td>
		<td>String</td>
		<td>For "single" and "many", the field on the parent containing _id of children. For "inversed", the field on the children containing the _id of the parent.</td>
	</tr>
	<tr>
		<td>cacheField</td>
		<td>String</td>
		<td>The field on the parent where children are cached.</td>
	</tr>
	<tr>
		<td>validate</td>
		<td>Boolean or undefined</td>
		<td>If set to true, the function will not attempt to bypass any collection2 schemas if they are defined. You must then make sure to include the cacheField in your schema.</td>
	</tr>
</table>

## Test the package

```
meteor test-packages packages/denormalize --driver-package=practicalmeteor:mocha
open localhost:3000 in browser
```