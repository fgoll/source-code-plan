

let foo = () => {
  var x = 1

  if (false) {
    console.log("never reached")
  }

  let a = 3

  return a
}


let baz = () => {
  var x = 1

  console.log(x)

  function unused() {
    return 5
  }

  return x

  var c = x + 3

  return c
}

baz()