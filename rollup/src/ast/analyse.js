import walk from './walk';
import Scope from './Scope';
import { getName } from '../utils/map-helpers';
import { has } from '../utils/object';
import getLocation from '../utils/getLocation';

export default function analyse ( ast, magicString, module ) {
	let scope = new Scope();
	let currentTopLevelStatement;

	function addToScope ( declarator ) {
		var name = declarator.id.name;
		scope.add( name, false );

		if ( !scope.parent ) {
			currentTopLevelStatement._defines[ name ] = true;
		}
	}

	function addToBlockScope ( declarator ) {
		var name = declarator.id.name;
		scope.add( name, true );

		if ( !scope.parent ) {
			currentTopLevelStatement._defines[ name ] = true;
		}
	}

	ast.body.forEach( statement => {
		currentTopLevelStatement = statement; // so we can attach scoping info

		Object.defineProperties( statement, {
			_defines:          { value: {} },
			_modifies:         { value: {} },
			_dependsOn:        { value: {} },
			_included:         { value: false, writable: true },
			_module:           { value: module },
			_source:           { value: magicString.snip( statement.start, statement.end ) }, // TODO don't use snip, it's a waste of memory
			_margin:           { value: [ 0, 0 ] },
			_leadingComments:  { value: [] },
			_trailingComment:  { value: null, writable: true },
		});

		walk( statement, {
			enter ( node ) {
				let newScope;

				switch ( node.type ) {
					case 'FunctionExpression':
					case 'FunctionDeclaration':
					case 'ArrowFunctionExpression':
						let names = node.params.map( getName );

						if ( node.type === 'FunctionDeclaration' ) {
							addToScope( node );
						} else if ( node.type === 'FunctionExpression' && node.id ) {
							names.push( node.id.name );
						}

						newScope = new Scope({
							parent: scope,
							params: names, // TODO rest params?
							block: false
						});

						break;

					case 'BlockStatement':
						newScope = new Scope({
							parent: scope,
							block: true
						});

						break;

					case 'VariableDeclaration':
						node.declarations.forEach( node.kind === 'let' ? addToBlockScope : addToScope ); // TODO const?
						break;

					case 'ClassDeclaration':
						addToScope( node );
						break;
				}

				if ( newScope ) {
					Object.defineProperty( node, '_scope', { value: newScope });
					scope = newScope;
				}
			},
			leave ( node ) {
				if ( node === currentTopLevelStatement ) {
					currentTopLevelStatement = null;
				}

				if ( node._scope ) {
					scope = scope.parent;
				}
			}
		});
	});

	ast.body.forEach( statement => {
		function checkForReads ( node, parent ) {
			if ( node.type === 'Identifier' ) {

				const definingScope = scope.findDefiningScope( node.name );

				if ( ( !definingScope || definingScope.depth === 0 ) && !statement._defines[ node.name ] ) {
					statement._dependsOn[ node.name ] = true;
				}
			}

		}

		walk( statement, {
			enter ( node, parent ) {
				// skip imports
				if ( /^Import/.test( node.type ) ) return this.skip();

				if ( node._scope ) scope = node._scope;

				checkForReads( node, parent );

			},
			leave ( node ) {
				if ( node._scope ) scope = scope.parent;
			}
		});
	});

	ast._scope = scope;
}