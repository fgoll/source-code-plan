import path from 'path'
import { has } from './utils/object'
import { defaultResolver } from './utils/resolvePath'
import { readFile, Promise } from 'sander'
import MagicString from 'magic-string'
import Module from './Module'
import ExternalModule from './ExternalModule'

function es6 ( bundle, magicString, exportMode, options ) {
	// TODO
	const introBlock = '';
	const exportBlock = '';

	return magicString.trim();
}

export default class Bundle {
  constructor( options ) {
    this.entryPath = path.resolve(options.entry).replace(/\.js$/, '') + '.js'
    this.base = path.dirname(this.entryPath)

    this.resolvePath = options.resolvePath || defaultResolver

    this.entryModule = null
    this.modulePromises = {}
    this.statements = []
    this.externalModules = []
    this.defaultExportName = null
    this.internalNamespaceModules = []

  } 

  fetchModule( importee, importer ) {
    // console.log(importee, importer)
    return Promise.resolve( importer === null ? importee : this.resolvePath(importee, importer))
      .then(path => {
        if (!path) {
          // external module
          if (!has(this.modulePromises, importee)) {
            const module = new ExternalModule(importee)
            this.externalModules.push(module)
            this.modulePromises[ importee ] = Promise.resolve(module)
          }
          return this.modulePromises[ importee ]
        }
        if (!has(this.modulePromises, path)) {
          this.modulePromises[ path ] = readFile(path, { encoding: "utf-8" }).then( code => {
            const module = new Module({
              path,
              code,
              bundle: this
            })
            // console.log(module)

            return module
          })
        }
        return this.modulePromises[ path ]
      })
  }

  build() {
    return this.fetchModule( this.entryPath, null )
      .then( entryModule => {
        // console.log(entryModule)
        this.entryModule = entryModule

        return entryModule.expandAllStatements( true );
      }).then((statements) => {
				console.log('this.statements', statements)
        this.statements = statements
      })
  }

  generate(options = {}) {
    let magicString = new MagicString.Bundle({ separator: '' });
		// Determine export mode - 'default', 'named', 'none'
		let exportMode = 'default'
		// Apply new names and add to the output bundle
		this.statements.forEach( statement => {
			const source = statement._source.clone().trim();

			// modify exports as necessary

			// add leading comments

			// add margin
			
			// add the statement itself
			magicString.addSource({
				content: source,
				separator: '\n'
			});

			// add trailing comments
		});

		// prepend bundle with internal namespaces
		const finalise = es6

		if ( !finalise ) {
			throw new Error( `You must specify an output type - valid options are ${keys( finalisers ).join( ', ' )}` );
		}

		magicString = finalise( this, magicString.trim(), exportMode, options );

		return {
			code: magicString.toString(),
			map: magicString.generateMap({
				includeContent: true,
				file: options.dest
				// TODO
			})
		};
  }
}