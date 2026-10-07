import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => cleanup())

// jsdom no implementa scrollIntoView; FormularioDuda lo llama en un temporizador que a veces
// dispara después de terminar el test y rompía la corrida con un error no capturado.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
