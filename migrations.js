import _ from 'lodash';
import { Mongo } from 'meteor/mongo';

export const MigrationHistory = new Mongo.Collection('_cacheMigrations');

let migrations = [];

export function addMigration(collection, insertFn, options) {
  let opts = _.clone(options);
  if (opts.collection) {
    //prevent Error: Converting circular structure to JSON
    opts.collection = opts.collection._name;
  }
  opts = JSON.stringify(opts);
  migrations.push({
    options: opts,
    collectionName: collection._name,
    collection: collection,
    cacheField: options.cacheField,
    fn: insertFn,
  });
}

export async function migrate(collectionName, cacheField, selector) {
  let migration = _.find(migrations, { collectionName, cacheField });
  if (!migration) {
    throw new Error(
      'no migration found for ' + collectionName + ' - ' + cacheField,
    );
  } else {
    let time = new Date();
    let n = 0;
    await migration.collection
      .find(selector || {})
      .forEachAsync(async (doc) => {
        await migration.fn(null, doc);
        n++;
      });
    console.log(
      `migrated ${cacheField} of ${n} docs in ${
        collectionName +
        (selector ? ' matching ' + JSON.stringify(selector) : '')
      }. It took ${new Date() - time}ms`,
    );
  }
}

export async function autoMigrate() {
  for (const migration of migrations) {
    if (
      !(await MigrationHistory.findOneAsync({
        collectionName: migration.collectionName,
        options: migration.options,
      }))
    ) {
      await migrate(migration.collectionName, migration.cacheField);
      await MigrationHistory.insertAsync({
        collectionName: migration.collectionName,
        options: migration.options,
        date: new Date(),
      });
    }
  }
}
