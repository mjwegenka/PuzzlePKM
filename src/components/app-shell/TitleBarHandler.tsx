/**
 * Transparent drag region overlay for the Tauri window title bar.
 *
 * A fixed, zero-visual-footprint element is placed at the very top of the
 * viewport with data-tauri-drag-region. Its height tracks the Window Controls
 * Overlay CSS env variable so it is:
 *   • Non-zero (≈38 px) inside Tauri with titleBarStyle "Overlay" on macOS.
 *   • 0 px in a plain browser tab, where env(titlebar-area-height) is
 *     undefined and the fallback kicks in — meaning the element is invisible
 *     and takes no interaction space.
 *
 * Because all interactive UI elements start below env(titlebar-area-height)
 * (the sidebar uses paddingTop: calc(env(titlebar-area-height,0px) + 12px)
 * and the main panel starts below the outer 12 px app padding), this overlay
 * never occludes any clickable content.
 *
 * The element is the topmost thing under the cursor in the title bar zone, so
 * Tauri's mousedown hit-test finds data-tauri-drag-region on the direct event
 * target — no ancestor-walking required.
 */
export default function TitleBarHandler() {
  return (
    <div
      data-tauri-drag-region
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 'env(titlebar-area-height, 0px)',
        zIndex: 9999,
        // Intentionally no background — purely a hit-test surface.
      }}
    />
  )
}
