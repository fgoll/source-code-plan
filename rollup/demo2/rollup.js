const { rollup } = require("rollup");

rollup('index.js').then(res => {
  res.write('bundle.js')
})