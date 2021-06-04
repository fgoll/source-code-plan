import { relative } from 'path'
import { parse } from 'acorn'
import { sequence } from './utils/promise';
import MagicString from 'magic-string'
import getLocation from './utils/getLocation'
import analyse from './ast/analyse'
import { has } from './utils/object';


const emptyArrayPromise = Promise.resolve([]);


export default class Module {
  constructor({ path, code, bundle }) {
    this.bundle = bundle
    this.path = path
    this.relativePath = relative(bundle.base, path).slice(0, -3) // 删除 .js

    this.code = new MagicString(code, {
      filename: path
    })

    this.suggestedNames = {}
    this.comments = []

    try {
      this.ast = parse( code, {
        ecmaVersion: 6,
        sourceType: "module",
        onComment: (block, text, start, end) => this.comments.push({ block, text, start, end })
      })

      require('fs').writeFileSync(__dirname + '/ast.js', JSON.stringify(this.ast))
    } catch(e) {
      e.file = path
      throw e
    }
    
    this.analyse()
  }

  analyse() {
    this.imports = {}
    this.exports = {}
    this.ast.body.forEach( node => {
      let source
      if (node.type === 'ImportDeclaration') {
        source = node.source.value

        node.specifiers.forEach( specifiers => {
          const isDefault = specifiers.type === 'ImportDefaultSpecifier'
          const isNamespace = specifiers.type === 'ImportNamespaceSpecifier'

          const localName  = specifiers.local.name

          const name = isDefault
                          ? 'default' : 
                            isNamespace 
                            ? '*' :
                              specifiers.imported.name
                            //  console.log(this.imports)
          if (this.imports[localName]) {
            const err = new Error(`Duplicated import '${localName}'`)
      
            err.file = this.path
            err.loc = getLocation( this.code.original, specifiers.start )
            throw err
          }

          this.imports[localName] = {
            source,
            name,
            localName
          }
        })
      } else if (/^Export/.test(node.type)) {
        if (node.type === 'ExportDefaultDeclaration') {
          const isDecaration = /Declaration$/.test( node.declaration.type )

          this.exports.default = {
            node,
            name: 'default',
            localName: isDecaration ? node.declaration.id.name : 'default',
            isDecaration
          } 
        } else if (node.type === 'ExportNamedDeclaration') {
          source = node.source && node.source.value

          if (node.specifiers.length) {
            node.specifiers.forEach( specifier => {
              const localName = specifier.local.name
              const exportedName = specifier.exported.name

              this.exports[ exportedName ] = {
                localName,
                exportedName
              }
              if (source) {
                this.imports[localName] = {
                  source,
                  localName,
                  name: exportedName
                }
              }
            })
          } else {
            let declaration = node.declaration

            let name 
            
            if (declaration.type === 'VariableDeclaration') {
              name = declaration.declarations[0].id.name
            } else {
              name = declaration.id.name
            }

            this.exports[name] = {
              node,
              localName: name,
              expression: declaration
            }
          }
        }
      }

    
    })

    analyse(this.ast, this.code, this);
    
    this.definedNames = this.ast._scope.names.slice();

    this.canonicalNames = {}

    this.definitions = {}
    this.definitionPromises = {}
    this.modifications = {}

    this.ast.body.forEach( statement => {
			Object.keys( statement._defines ).forEach( name => {
				this.definitions[ name ] = statement;
			});

			Object.keys( statement._modifies ).forEach( name => {
				if ( !has( this.modifications, name ) ) {
					this.modifications[ name ] = [];
				}

				this.modifications[ name ].push( statement );
			});
		});
  }

  expandAllStatements(isEntryModule) {
    let allStatements = [];

    return sequence(this.ast.body, statement => {
      
    	return this.expandStatement( statement )
        .then( statements => {
          allStatements.push.apply( allStatements, statements );
        })  
    }).then(() => {
      return allStatements
    })
  }

  expandStatement(statement) {
    if ( statement._included ) return emptyArrayPromise;
		statement._included = true;
    let result = [];

    const dependencies = Object.keys(statement._dependsOn)

    return sequence( dependencies, name => {
			return this.define( name ).then( definition => {
        console.log('definition', definition)
				result.push.apply( result, definition );
			});
		}).then( () => {
      result.push( statement );
    }).then(() => {
      return result
    })
  }

  define( name ) {
    if ( has( this.definitionPromises, name ) ) {
			return emptyArrayPromise;
		}

    let promise 

    if (has(this.imports, name)) {
      const importDeclaration = this.imports[name]
      promise = this.bundle.fetchModule(importDeclaration.source, this.path).then(module => {
        importDeclaration.module = module

        if ( module.isExternal ) {
          module.importedByBundle.push( importDeclaration );
          return emptyArrayPromise;
        }

        if ( importDeclaration.name === '*' ) {
          // we need to create an internal namespace
          if ( !~this.bundle.internalNamespaceModules.indexOf( module ) ) {
            this.bundle.internalNamespaceModules.push( module );
          }

          return module.expandAllStatements();
        }

        const exportDeclaration = module.exports[ importDeclaration.name ];

        if ( !exportDeclaration ) {
          console.log('err')
          throw new Error( `Module ${module.path} does not export ${importDeclaration.name} (imported by ${this.path})` );
        }

        return module.define( exportDeclaration.localName );
      })
    }	else {
			let statement;

			if ( name === 'default' ) {
				// TODO can we use this.definitions[ name ], as below?
				statement = this.exports.default.node;
			}

			else {
				statement = this.definitions[ name ];
			}

			if ( statement && !statement._included ) {
				promise = this.expandStatement( statement );
			}
		}
    
		this.definitionPromises[ name ] = promise || emptyArrayPromise;
		return this.definitionPromises[ name ];
  }
}