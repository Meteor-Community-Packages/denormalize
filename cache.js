import _ from 'lodash'

debug = true
log = function(){
	if(debug){
		console.log(...arguments)
	}
}
flattenFields = function(object, prefix){
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
		type:Match.OneOf('single', 'many', 'inversed', 'inverse'),
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
	if(!_.includes(watchedFields, '_id') && type !== 'single'){
		watchedFields.push('_id')
	}
	if(!_.includes(watchedFields, referenceField) && type == 'inversed'){
		watchedFields.push(referenceField)
	}

	let topFields = watchedFields.map(field => field.split('.')[0])

	let childOpts = {transform:null, fields:{_id:0}}
	_.each(watchedFields, field => childOpts.fields[field] = 1)
	let parentOpts = {transform:null, fields:{_id:1, [referenceField]:1, [cacheField]:1}}

	parentCollection.after.insert(function(userId, parent){
		log('PARENT - INSERT', parent._id)
		log('cache', childCollection._name, 'to', options.cacheField, 'in', parentCollection._name)

		if(type == 'inversed'){
			let children = childCollection.find({[referenceField]:parent._id}, childOpts).fetch()
			console.log('CHILDREN', children)
			parentCollection.update(parent._id, {$set:{[cacheField]:children}})
		} else if(type == 'many'){
			if(parent[referenceField]){
				let children = childCollection.find({_id:{$in:parent[referenceField]}}, childOpts).fetch()
				parentCollection.update(parent._id, {$set:{[cacheField]:children}})
			} else {
				parentCollection.update(parent._id, {$set:{[cacheField]:[]}})
			}
		} else if(parent[referenceField]){ //type == 'single'
			let child = childCollection.findOne(parent[referenceField], childOpts)
			if(child){
				parentCollection.update(parent._id, {$set:{[cacheField]:child}})
			}
		}
	})
	parentCollection.after.update(function(userId, parent, fieldNames){
		if(_.includes(fieldNames, referenceField)){ //Only update if the referenceField was changed
			log('PARENT - UPDATE', parent._id)
			log('cache', childCollection._name, 'to', options.cacheField, 'in', parentCollection._name)

			if(!parent[referenceField]){
				if(type == 'inversed' || type == 'many'){ //Should always have at least an empty array
					parentCollection.update(parent._id, {$set:{[cacheField]:[]}})
				}
			} else if(type == 'inversed'){
				let children = childCollection.find({[referenceField]:parent._id}, childOpts).fetch()
				parentCollection.update(parent._id, {$set:{[cacheField]:children}})
			} else if(type == 'many'){
				let children = childCollection.find({_id:{$in:parent[referenceField]}}, childOpts).fetch()
				parentCollection.update(parent._id, {$set:{[cacheField]:children}})
			} else { //type == 'single'
				let child = parent[referenceField] && childCollection.findOne(parent[referenceField], childOpts)
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
			if(child[referenceField]){
				parentCollection.update({_id:child[referenceField]}, {$push:{[cacheField]:pickedChild}})
			}
		} else if(type == 'many'){
			parentCollection.update({[referenceField]:child._id}, {$push:{[cacheField]:pickedChild}}, {multi:true})
		} else { //type == 'single'
			parentCollection.update({[referenceField]:child._id}, {$set:{[cacheField]:pickedChild}}, {multi:true})
		}
	})
	childCollection.after.update(function(userId, child, fieldNames){
		if(_.intersection(fieldNames, topFields)){
			log('CHILD - UPDATE', child._id)
			log('cache', childCollection._name, 'to', options.cacheField, 'in', parentCollection._name)

			let pickedChild = _.pick(child, watchedFields)

			if(type == 'inversed'){
				let previousId = this.previous && this.previous[referenceField]
				if(previousId && previousId !== child[referenceField]){
					parentCollection.update({_id:previousId}, {$pull:{[cacheField]:{_id:child._id}}})
				}
				parentCollection.find({_id:child[referenceField]}, parentOpts).forEach(parent => {
					let index = _.findIndex(parent[cacheField], {_id:child._id})
					if(index > -1){
						parentCollection.update(parent._id, {$set:{[cacheField + '.' + index]:pickedChild}})
					} else {
						parentCollection.update(parent._id, {$push:{[cacheField]:pickedChild}})
					}
				})
			} else if(type == 'many'){
				parentCollection.find({[referenceField]:child._id}, parentOpts).forEach(parent => {
					let index = _.findIndex(parent[cacheField], {_id:child._id})
					if(index > -1){
						parentCollection.update(parent._id, {$set:{[cacheField + '.' + index]:pickedChild}})
					} else {
						parentCollection.update(parent._id, {$push:{[cacheField]:pickedChild}})
					}
				})
			} else { //type == 'single'
				parentCollection.update({[referenceField]:child._id}, {$set:{[cacheField]:pickedChild}}, {multi:true})
			}			
		}
	})
	childCollection.after.remove(function(userId, child){
		log('CHILD - REMOVE', child._id)
		log('cache', childCollection._name, 'to', options.cacheField, 'in', parentCollection._name)

		if(type == 'inversed'){
			parentCollection.update({_id:child[referenceField]}, {$pull:{[cacheField]:{_id:child._id}}})
		} else if(type == 'many'){
			parentCollection.update({[referenceField]:child._id}, {$pull:{[cacheField]:{_id:child._id}}}, {multi:true})
		} else { //type == 'single'
			parentCollection.update({[referenceField]:child._id}, {$unset:{[cacheField]:1}}, {multi:true})
		}
	})
}