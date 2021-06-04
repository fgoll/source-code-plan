import { writeFile } from 'sander'
import Bundle from './Bundle'

function rollup(entry, options = {}) {
  const bundle = new Bundle({
    entry,
    resolvePath: options.resolvePath
  })

  return bundle.build().then(() => {
    return {
      generate: options => bundle.generate(options),
      write: (dest, options = {}) => {
        console.log('wite')
        try {
          
          let { code, map } = bundle.generate({
            dest,
            format: options.format,
            globalName: options.globalName
          })
          console.log('code',code)
  
          return Promise.all([
            writeFile(dest, code),
            writeFile(dest + '.map', map.toString())
          ])
        } catch(e) {
          console.log(e)
        }
      }
    }
  })
}

module.exports = rollup