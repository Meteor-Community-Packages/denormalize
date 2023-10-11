Package.describe({
  name: 'herteby:denormalize',
  version: '0.6.7',
  // Brief, one-line summary of the package.
  summary: 'Simple denormalization for Meteor',
  // URL to the Git repository containing the source code for this package.
  git: 'https://github.com/herteby/denormalize',
  // By default, Meteor will default to using README.md for documentation.
  // To avoid submitting documentation, set this field to null.
  documentation: 'README.md'
})

const npmPackages = {
  'lodash': '4.17.21',
};


Package.onUse(function (api) {
  Npm.depends(npmPackages);

  api.versionsFrom('1.12.1')
  api.use([
    'ecmascript',
    'mongo',
    'check',
    'matb33:collection-hooks@1.2.0'
  ])

  api.mainModule('cache.js', 'server')
  api.addFiles('cacheCount.js', 'server')
  api.addFiles('cacheField.js', 'server')
})

Package.onTest(function (api) {
  Npm.depends({
    ...npmPackages,
    chai: "4.3.4"
  });

  api.use([
    'herteby:denormalize',
    'ecmascript',
    'mongo',
    'check',
    'meteortesting:mocha',
    'matb33:collection-hooks@1.2.0'
  ])

  api.use(["meteortesting:mocha"]);

  api.addFiles('tests.js', 'server')
})
