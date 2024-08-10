import _ from 'lodash';
import { addMigration, migrate, autoMigrate } from './migrations.js';

export { migrate, autoMigrate };

function flattenFields(object, prefix) {
  prefix = prefix || '';
  let fields = [];
  _.each(object, (val, key) => {
    if (typeof val == 'object') {
      fields = _.union(fields, flattenFields(val, prefix + key + '.'));
    } else {
      fields.push(prefix + key);
    }
  });
  return fields;
}

Mongo.Collection.prototype.cache = function (options) {
  check(options, {
    collection: Match.Where(
      (collection) => collection instanceof Mongo.Collection,
    ),
    fields: Match.OneOf([String], Object),
    type: Match.OneOf(
      'one',
      'many',
      'inversed',
      'inverse',
      'many-inversed',
      'many-inverse',
    ),
    referenceField: String,
    cacheField: String,
    bypassSchema: Match.Optional(Boolean),
  });
  if (options.type == 'inverse') options.type = 'inversed'; //Not sure which is best, so why not support both and be typo-friendly
  if (options.type == 'many-inverse') options.type = 'many-inversed';

  //Bypass collection2 schemas
  let parentCollection =
    options.bypassSchema && Package['aldeed:collection2']
      ? this._collection
      : this;
  let childCollection = options.collection;
  let type = options.type;
  let referenceField = options.referenceField;
  let cacheField = options.cacheField;
  let watchedFields = options.fields;

  if (referenceField.split(/[.:]/)[0] == cacheField.split(/[.:]/)[0]) {
    throw new Error(
      'referenceField and cacheField must not share the same top field',
    );
  }

  if (!Array.isArray(watchedFields)) {
    watchedFields = flattenFields(watchedFields);
  }

  let childFields = _.clone(watchedFields);
  if (type !== 'one') {
    if (!_.includes(childFields, '_id')) {
      childFields.push('_id');
    }
    _.pull(childFields, referenceField);
  }
  let childOpts = { transform: null, fields: { _id: 0 } };
  _.each(childFields, (field) => (childOpts.fields[field] = 1));

  let parentOpts = { transform: null, fields: { _id: 1, [cacheField]: 1 } };
  if (type !== 'inversed' && type !== 'many-inversed') {
    parentOpts.fields[referenceField.split(':')[0]] = 1;
  }

  let idField, referencePath;
  if (type == 'many' || type == 'many-inversed') {
    referencePath = referenceField.replace(':', '.');
    idField = referenceField.split(':')[1];
    referenceField = referenceField.split(':')[0];
  }

  if (
    type == 'inversed' ||
    (type == 'many-inversed' && !_.includes(watchedFields, referencePath))
  ) {
    watchedFields.push(referencePath || referenceField);
  }

  let topFields = _.uniq(watchedFields.map((field) => field.split('.')[0]));

  function getNestedReferences(document) {
    //Used for nested references in "many" links
    let references = _.get(document, referenceField) || [];
    if (idField && references.length) {
      references = _.map(references, (item) => _.get(item, idField));
    }
    return _.uniq(_.flatten(references));
  }

  if (type == 'one') {
    let insert = async function insert(userId, parent) {
      if (_.get(parent, referenceField)) {
        let child = await childCollection.findOneAsync(
          _.get(parent, referenceField),
          childOpts,
        );
        if (child) {
          await parentCollection.updateAsync(parent._id, {
            $set: { [cacheField]: child },
          });
        }
      }
    };
    addMigration(parentCollection, insert, options);
    parentCollection.after.insert(insert);

    parentCollection.after.update(async function (
      userId,
      parent,
      changedFields,
    ) {
      if (_.includes(changedFields, referenceField.split('.')[0])) {
        let child =
          _.get(parent, referenceField) &&
          (await childCollection.findOneAsync(
            _.get(parent, referenceField),
            childOpts,
          ));
        if (child) {
          await parentCollection.updateAsync(parent._id, {
            $set: { [cacheField]: child },
          });
        } else {
          await parentCollection.updateAsync(parent._id, {
            $unset: { [cacheField]: 1 },
          });
        }
      }
    });

    childCollection.after.insert(async function (userId, child) {
      let pickedChild = _.pick(child, childFields);
      await parentCollection.updateAsync(
        { [referenceField]: child._id },
        { $set: { [cacheField]: pickedChild } },
        { multi: true },
      );
    });

    childCollection.after.update(async function (userId, child, changedFields) {
      if (_.intersection(changedFields, topFields).length) {
        let pickedChild = _.pick(child, childFields);
        await parentCollection.updateAsync(
          { [referenceField]: child._id },
          { $set: { [cacheField]: pickedChild } },
          { multi: true },
        );
      }
    });

    childCollection.after.remove(async function (userId, child) {
      await parentCollection.updateAsync(
        { [referenceField]: child._id },
        { $unset: { [cacheField]: 1 } },
        { multi: true },
      );
    });
  } else if (type == 'many') {
    let insert = async function insert(userId, parent) {
      let references = getNestedReferences(parent);
      if (references.length) {
        let children = await childCollection
          .find({ _id: { $in: references } }, childOpts)
          .fetchAsync();
        await parentCollection.updateAsync(parent._id, {
          $set: { [cacheField]: children },
        });
      } else {
        await parentCollection.updateAsync(parent._id, {
          $set: { [cacheField]: [] },
        });
      }
    };
    addMigration(parentCollection, insert, options);
    parentCollection.after.insert(insert);

    parentCollection.after.update(async function (
      userId,
      parent,
      changedFields,
    ) {
      if (_.includes(changedFields, referencePath.split('.')[0])) {
        let references = getNestedReferences(parent);
        if (references.length) {
          let children = await childCollection
            .find({ _id: { $in: references } }, childOpts)
            .fetchAsync();
          await parentCollection.updateAsync(parent._id, {
            $set: { [cacheField]: children },
          });
        } else {
          await parentCollection.updateAsync(parent._id, {
            $set: { [cacheField]: [] },
          });
        }
      }
    });

    childCollection.after.insert(async function (userId, child) {
      let pickedChild = _.pick(child, childFields);
      await parentCollection.updateAsync(
        { [referencePath]: child._id },
        { $push: { [cacheField]: pickedChild } },
        { multi: true },
      );
    });

    childCollection.after.update(async function (userId, child, changedFields) {
      if (_.intersection(changedFields, topFields).length) {
        let pickedChild = _.pick(child, childFields);
        await parentCollection
          .find({ [referencePath]: child._id }, parentOpts)
          .forEachAsync(async (parent) => {
            let index = _.findIndex(_.get(parent, cacheField), {
              _id: child._id,
            });
            if (index > -1) {
              await parentCollection.updateAsync(parent._id, {
                $set: { [cacheField + '.' + index]: pickedChild },
              });
            } else {
              await parentCollection.updateAsync(parent._id, {
                $push: { [cacheField]: pickedChild },
              });
            }
          });
      }
    });

    childCollection.after.remove(async function (userId, child) {
      await parentCollection.updateAsync(
        { [referencePath]: child._id },
        { $pull: { [cacheField]: { _id: child._id } } },
        { multi: true },
      );
    });
  } else if (type == 'inversed') {
    let insert = async function insert(userId, parent) {
      let children = await childCollection
        .find({ [referenceField]: parent._id }, childOpts)
        .fetchAsync();
      await parentCollection.updateAsync(parent._id, {
        $set: { [cacheField]: children },
      });
    };
    addMigration(parentCollection, insert, options);

    parentCollection.after.insert(insert);

    parentCollection.after.update(async function (
      userId,
      parent,
      changedFields,
    ) {
      if (_.includes(changedFields, referenceField.split('.')[0])) {
        if (_.get(parent, referenceField)) {
          let children = await childCollection
            .find({ [referenceField]: parent._id }, childOpts)
            .fetchAsync();
          await parentCollection.updateAsync(parent._id, {
            $set: { [cacheField]: children },
          });
        } else {
          await parentCollection.updateAsync(parent._id, {
            $set: { [cacheField]: [] },
          });
        }
      }
    });

    childCollection.after.insert(async function (userId, child) {
      let pickedChild = _.pick(child, childFields);
      if (_.get(child, referenceField)) {
        await parentCollection.updateAsync(
          { _id: _.get(child, referenceField) },
          { $push: { [cacheField]: pickedChild } },
        );
      }
    });

    childCollection.after.update(async function (userId, child, changedFields) {
      if (_.intersection(changedFields, topFields).length) {
        let pickedChild = _.pick(child, childFields);
        let previousId = this.previous && _.get(this.previous, referenceField);
        if (previousId && previousId !== _.get(child, referenceField)) {
          await parentCollection.updateAsync(
            { _id: previousId },
            { $pull: { [cacheField]: { _id: child._id } } },
          );
        }
        await parentCollection
          .find({ _id: _.get(child, referenceField) }, parentOpts)
          .forEachAsync(async (parent) => {
            let index = _.findIndex(_.get(parent, cacheField), {
              _id: child._id,
            });
            if (index > -1) {
              await parentCollection.updateAsync(parent._id, {
                $set: { [cacheField + '.' + index]: pickedChild },
              });
            } else {
              await parentCollection.updateAsync(parent._id, {
                $push: { [cacheField]: pickedChild },
              });
            }
          });
      }
    });

    childCollection.after.remove(async function (userId, child) {
      await parentCollection.updateAsync(
        { _id: _.get(child, referenceField) },
        { $pull: { [cacheField]: { _id: child._id } } },
      );
    });
  } else if (type == 'many-inversed') {
    let insert = async function insert(userId, parent) {
      let children = await childCollection
        .find({ [referencePath]: parent._id }, childOpts)
        .fetchAsync();
      await parentCollection.updateAsync(parent._id, {
        $set: { [cacheField]: children },
      });
    };
    addMigration(parentCollection, insert, options);

    parentCollection.after.insert(insert);

    parentCollection.after.update(async function (
      userId,
      parent,
      changedFields,
    ) {
      if (_.includes(changedFields, referencePath.split('.')[0])) {
        let children = await childCollection
          .find({ [referencePath]: parent._id }, childOpts)
          .fetchAsync();
        await parentCollection.updateAsync(parent._id, {
          $set: { [cacheField]: children },
        });
      }
    });

    childCollection.after.insert(async function (userId, child) {
      let references = getNestedReferences(child);
      if (references.length) {
        let pickedChild = _.pick(child, childFields);
        await parentCollection.updateAsync(
          { _id: { $in: references } },
          { $push: { [cacheField]: pickedChild } },
          { multi: true },
        );
      }
    });

    childCollection.after.update(async function (userId, child, changedFields) {
      if (_.intersection(changedFields, topFields).length) {
        let references = getNestedReferences(child);
        let previousIds = this.previous && getNestedReferences(this.previous);
        previousIds = _.difference(previousIds, references);
        if (previousIds.length) {
          await parentCollection.updateAsync(
            { _id: { $in: previousIds } },
            { $pull: { [cacheField]: { _id: child._id } } },
            { multi: true },
          );
        }
        if (references.length) {
          let pickedChild = _.pick(child, childFields);
          await parentCollection
            .find({ _id: { $in: references } }, parentOpts)
            .forEachAsync(async (parent) => {
              let index = _.findIndex(_.get(parent, cacheField), {
                _id: child._id,
              });
              if (index > -1) {
                await parentCollection.updateAsync(parent._id, {
                  $set: { [cacheField + '.' + index]: pickedChild },
                });
              } else {
                await parentCollection.updateAsync(parent._id, {
                  $push: { [cacheField]: pickedChild },
                });
              }
            });
        }
      }
    });

    childCollection.after.remove(async function (userId, child) {
      let references = getNestedReferences(child);
      if (references.length) {
        await parentCollection.updateAsync(
          { _id: { $in: references } },
          { $pull: { [cacheField]: { _id: child._id } } },
          { multi: true },
        );
      }
    });
  }
};
