import path from 'path'
import { has } from './utils/object'
import { defaultResolver } from './utils/resolvePath'
import { readFile, Promise } from 'sander'
import Module from './Module'
import ExternalModule from './ExternalModule'

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
        this.statements = statements
      })
  }

  generate(options = {}) {
    let magicString = new MagicString.Bundle({ separator: '' });

		// Determine export mode - 'default', 'named', 'none'
		let exportMode = 'default'


		// Apply new names and add to the output bundle
		this.statements.forEach( statement => {
			let replacements = {};

			keys( statement._dependsOn )
				.concat( keys( statement._defines ) )
				.forEach( name => {
					const canonicalName = statement._module.getCanonicalName( name );

					if ( name !== canonicalName ) {
						replacements[ name ] = canonicalName;
					}
				});

			const source = statement._source.clone().trim();

			// modify exports as necessary
			if ( /^Export/.test( statement.type ) ) {
				// skip `export { foo, bar, baz }`
				if ( statement.type === 'ExportNamedDeclaration' && statement.specifiers.length ) {
					return;
				}

				// remove `export` from `export var foo = 42`
				if ( statement.type === 'ExportNamedDeclaration' && statement.declaration.type === 'VariableDeclaration' ) {
					source.remove( statement.start, statement.declaration.start );
				}

				// remove `export` from `export class Foo {...}` or `export default Foo`
				// TODO default exports need different treatment
				else if ( statement.declaration.id ) {
					source.remove( statement.start, statement.declaration.start );
				}

				else if ( statement.type === 'ExportDefaultDeclaration' ) {
					const module = statement._module;
					const canonicalName = module.getCanonicalName( 'default' );

					if ( statement.declaration.type === 'Identifier' && canonicalName === module.getCanonicalName( statement.declaration.name ) ) {
						return;
					}

					source.overwrite( statement.start, statement.declaration.start, `var ${canonicalName} = ` );
				}

				else {
					throw new Error( 'Unhandled export' );
				}
			}

			replaceIdentifiers( statement, source, replacements );

			// add leading comments
			if ( statement._leadingComments.length ) {
				const commentBlock = statement._leadingComments.map( comment => {
					return comment.block ?
						`/*${comment.text}*/` :
						`//${comment.text}`;
				}).join( '\n' );

				magicString.addSource( new MagicString( commentBlock ) );
			}

			// add margin
			const margin = Math.max( statement._margin[0], previousMargin );
			const newLines = new Array( margin ).join( '\n' );

			// add the statement itself
			magicString.addSource({
				content: source,
				separator: newLines
			});

			// add trailing comments
			const comment = statement._trailingComment;
			if ( comment ) {
				const commentBlock = comment.block ?
					` /*${comment.text}*/` :
					` //${comment.text}`;

				magicString.append( commentBlock );
			}

			previousMargin = statement._margin[1];
		});

		// prepend bundle with internal namespaces
		const indentString = magicString.getIndentString();
		const namespaceBlock = this.internalNamespaceModules.map( module => {
			const exportKeys = keys( module.exports );

			return `var ${module.getCanonicalName('*')} = {\n` +
				exportKeys.map( key => `${indentString}get ${key} () { return ${module.getCanonicalName(key)}; }` ).join( ',\n' ) +
			`\n};\n\n`;
		}).join( '' );

		magicString.prepend( namespaceBlock );

		const finalise = finalisers[ options.format || 'es6' ];

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