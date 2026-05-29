/**
 * ForceGraph2DWrapper.tsx
 *
 * A thin React wrapper around the `force-graph` (2D canvas) kapsule component,
 * built directly with `react-kapsule`. This bypasses `react-force-graph` entirely,
 * avoiding initialization of the 3D/VR/AR sub-components that depend on THREE.js,
 * AFRAME, and WebXR — none of which are needed for 2D canvas rendering.
 */

import { type ComponentType } from 'react'
import reactKapsule from 'react-kapsule'
import ForceGraphKapsule from 'force-graph'

const ForceGraph2D = reactKapsule(ForceGraphKapsule as unknown as never, {
  wrapperElementType: 'div',
  // Expose imperative methods via ref so callers can call e.g. ref.current.zoomToFit()
  methodNames: [
    'zoomToFit',
    'zoom',
    'centerAt',
    'pauseAnimation',
    'resumeAnimation',
    'd3Force',
    'd3ReheatSimulation',
  ],
}) as ComponentType<Record<string, unknown>>

export default ForceGraph2D
