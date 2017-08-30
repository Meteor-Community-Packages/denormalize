import _ from 'lodash'

let settings = {}
export default settings
function log(){
	if(settings.debug){
		console.log(...arguments)
	}
}

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
		type:Match.OneOf('one', 'many', 'inversed', 'inverse'),
		referenceField:String,
		cacheField:String,
		validate:Match.Optional(Boolean)
	})
	if(options.type == 'inverse') options.type = 'inversed' //Not sure which is best, so why not support both and be typo-friendly

	let childCollection = !options.validate && Package['aldeed:collection2'] ? options.collection._collection : options.collection
	let parentCollection = this
	let type = options.type
	let referenceField = options.referenceField
	let cacheField = options.cacheField
	let watchedFields = options.fields

	if(!_.isArray(watchedFields)){
		watchedFields = flattenFields(watchedFields)
	}
	if(type !== 'one' && !_.includes(watchedFields, '_id')){
		watchedFields.push('_id')
	}

	let idField, referencePath
	if(type == 'many'){
		referencePath = referenceField.replace(':', '.')
		idField = referenceField.split(':')[1]
		referenceField = referenceField.split(':')[0]
	}

	if(type == 'inversed' && !_.includes(watchedFields, referenceField)){
		watchedFields.push(referenceField)
	}
	
	let topFields = watchedFields.map(field => field.split('.')[0])

	let childOpts = {transform:null, fields:{_id:0}}
	_.each(watchedFields, field => childOpts.fields[field] = 1)
	let parentOpts = {transform:null, fields:{_id:1, [referenceField.split(':')[0]]:1, [cacheField]:1}}

	function getNestedReferences(parent){ //Used for nested references in "many" links
		let references = _.get(parent, referenceField) || []
		if(idField && references.length){
			references = _.map(references, item => _.get(item, idField))
		}
		return references
	}

	parentCollection.after.insert(function(userId, parent){
		log('PARENT - INSERT', parent._id)
		log('cache', childCollection._name, 'to', options.cacheField, 'in', parentCollection._name)

		if(type == 'inversed'){
			let children = childCollection.find({[referenceField]:parent._id}, childOpts).fetch()
			parentCollection.update(parent._id, {$set:{[cacheField]:children}})
		} else if(type == 'many'){
			let references = getNestedReferences(parent)
			if(references.length){
				let children = childCollection.find({_id:{$in:references}}, childOpts).fetch()
				parentCollection.update(parent._id, {$set:{[cacheField]:children}})
			} else {
				parentCollection.update(parent._id, {$set:{[cacheField]:[]}})
			}
		} else if(_.get(parent, referenceField)){ //type == 'one'
			let child = childCollection.findOne(_.get(parent, referenceField), childOpts)
			if(child){
				parentCollection.update(parent._id, {$set:{[cacheField]:child}})
			}
		}
	})
	parentCollection.after.update(function(userId, parent, fieldNames){
		if(_.includes(fieldNames, referenceField.split('.')[0])){ //Only update if the referenceField was changed
			log('PARENT - UPDATE', parent._id)
			log('cache', childCollection._name, 'to', options.cacheField, 'in', parentCollection._name)

			if(!_.get(parent, referenceField)){
				if(type == 'inversed' || type == 'many'){ //Should always have at least an empty array
					parentCollection.update(parent._id, {$set:{[cacheField]:[]}})
				}
			} else if(type == 'inversed'){
				let children = childCollection.find({[referenceField]:parent._id}, childOpts).fetch()
				parentCollection.update(parent._id, {$set:{[cacheField]:children}})
			} else if(type == 'many'){
				let references = getNestedReferences(parent)
				if(references.length){
					let children = childCollection.find({_id:{$in:references}}, childOpts).fetch()
					parentCollection.update(parent._id, {$set:{[cacheField]:children}})
				} else {
					parentCollection.update(parent._id, {$set:{[cacheField]:[]}})
				}				
			} else { //type == 'one'
				let child = _.get(parent, referenceField) && childCollection.findOne(_.get(parent, referenceField), childOpts)
				if(child){
					parentCollection.update(parent._id, {$set:{[cacheField]:child}})
				} else {
					parentCollection.update(parent._id, {$unset:{[cacheField]:1}})
				}
			}
		}
	})
	childCollection.after.insert(function(userId, child){
		log('CHILD - INSERT', child._id)
		log('cache', childCollection._name, 'to', options.cacheField, 'in', parentCollection._name)

		let pickedChild = _.pick(child, watchedFields)

		if(type == 'inversed'){
			if(_.get(child, referenceField)){
				parentCollection.update({_id:_.get(child, referenceField)}, {$push:{[cacheField]:pickedChild}})
			}
		} else if(type == 'many'){
			parentCollection.update({[referencePath]:child._id}, {$push:{[cacheField]:pickedChild}}, {multi:true})
		} else { //type == 'one'
			parentCollection.update({[referenceField]:child._id}, {$set:{[cacheField]:pickedChild}}, {multi:true})
		}
	})
	childCollection.after.update(function(userId, child, fieldNames){
		if(_.intersection(fieldNames, topFields)){
			log('CHILD - UPDATE', child._id)
			log('cache', childCollection._name, 'to', options.cacheField, 'in', parentCollection._name)

			let pickedChild = _.pick(child, watchedFields)

			if(type == 'inversed'){
				let previousId = this.previous && _.get(this.previous, referenceField)
				if(previousId && previousId !== _.get(child, referenceField)){
					parentCollection.update({_id:previousId}, {$pull:{[cacheField]:{_id:child._id}}})
				}
				parentCollection.find({_id:_.get(child, referenceField)}, parentOpts).forEach(parent => {
					let index = _.findIndex(parent[cacheField], {_id:child._id})
					if(index > -1){
						parentCollection.update(parent._id, {$set:{[cacheField + '.' + index]:pickedChild}})
					} else {
						parentCollection.update(parent._id, {$push:{[cacheField]:pickedChild}})
					}
				})
			} else if(type == 'many'){
				parentCollection.find({[referencePath]:child._id}, parentOpts).forEach(parent => {
					let index = _.findIndex(parent[cacheField], {_id:child._id})
					if(index > -1){
						parentCollection.update(parent._id, {$set:{[cacheField + '.' + index]:pickedChild}})
					} else {
						parentCollection.update(parent._id, {$push:{[cacheField]:pickedChild}})
					}
				})
			} else { //type == 'one'
				parentCollection.update({[referenceField]:child._id}, {$set:{[cacheField]:pickedChild}}, {multi:true})
			}			
		}
	})
	childCollection.after.remove(function(userId, child){
		log('CHILD - REMOVE', child._id)
		log('cache', childCollection._name, 'to', options.cacheField, 'in', parentCollection._name)

		if(type == 'inversed'){
			parentCollection.update({_id:_.get(child, referenceField)}, {$pull:{[cacheField]:{_id:child._id}}})
		} else if(type == 'many'){
			parentCollection.update({[referencePath]:child._id}, {$pull:{[cacheField]:{_id:child._id}}}, {multi:true})
		} else { //type == 'one'
			parentCollection.update({[referenceField]:child._id}, {$unset:{[cacheField]:1}}, {multi:true})
		}
	})
}