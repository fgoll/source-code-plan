const rollup = require('../dist/rollup')

try {
  rollup(__dirname + '/main.js').then(res => {
    console.log(res)
    res.write('./bundle.js')
  })
} catch(e) {
  console.log(e)
}