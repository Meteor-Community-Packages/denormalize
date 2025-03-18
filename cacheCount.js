import _ from 'lodash';
import { addMigration } from './migrations.js';
import { check, Match } from 'meteor/check';

Mongo.Collection.prototype.cacheCount = function (options) {
  check(options, {
    collection: Mongo.Collection,
    cacheField: String,
    referenceField: String,
    selector: Match.Optional(Object),
    bypassSchema: Match.Optional(Boolean),
  });

  let parentCollection =
    options.bypassSchema && Package['aldeed:collection2']
      ? this._collection
      : this;
  let childCollection = options.collection;
  let selector = options.selector || {};
  let cacheField = options.cacheField;
  let referenceField = options.referenceField;
  let watchedFields = _.union([referenceField], Object.keys(selector));

  if (referenceField.split(/[.:]/)[0] == cacheField.split(/[.:]/)[0]) {
    throw new Error(
      'referenceField and cacheField must not share the same top field',
    );
  }

  async function update(child) {
    let ref = _.get(child, referenceField);
    if (ref) {
      let select = _.merge(selector, { [referenceField]: ref });
      await parentCollection.updateAsync(
        { _id: ref },
        {
          $set: {
            [cacheField]: await childCollection.find(select).countAsync(),
          },
        },
      );
    }
  }

  async function insert(userId, parent) {
    let select = _.merge(selector, { [referenceField]: parent._id });
    await parentCollection.updateAsync(parent._id, {
      $set: { [cacheField]: await childCollection.find(select).countAsync() },
    });
  }

  addMigration(parentCollection, insert, options);

  parentCollection.after.insert(insert);

  childCollection.after.insert(async (userId, child) => {
    await update(child);
  });

  childCollection.after.update(async (userId, child, changedFields) => {
    if (_.intersection(changedFields, watchedFields).length) {
      await update(child);
      await update(this.previous);
    }
  });

  childCollection.after.remove(async (userId, child) => {
    await update(child);
  });
};
