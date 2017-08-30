Package.describe({
	name: 'herteby:denormalize',
	version: '0.3.0',
	// Brief, one-line summary of the package.
	summary: 'Simple denormalization for Meteor',
	// URL to the Git repository containing the source code for this package.
	git: 'https://github.com/herteby/denormalize',
	// By default, Meteor will default to using README.md for documentation.
	// To avoid submitting documentation, set this field to null.
	documentation: 'README.md'
})

Npm.depends({
	'lodash': '4.17.4',
})

Package.onUse(function (api) {
	api.versionsFrom('1.5')
	api.use([
		'ecmascript',
		'mongo',
		'check',
		'matb33:collection-hooks@0.8.4'
		])

	api.mainModule('cache.js', 'server')
})

Package.onTest(function (api) {
	api.use([
		'herteby:denormalize',
		'ecmascript',
		'mongo',
		'check',
		'matb33:collection-hooks@0.8.4',
		'practicalmeteor:mocha',
		'practicalmeteor:chai'
		])

	api.addFiles('tests.js', 'server')
})