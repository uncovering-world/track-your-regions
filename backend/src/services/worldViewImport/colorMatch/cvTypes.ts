/**
 * The OpenCV namespace types the colour match's OpenCV-backed passes share.
 *
 * Type-only on purpose: OpenCV is loaded once, by
 * `controllers/admin/wvImportMatchJsBranch.ts`, onto `globalThis.__cv`, and a
 * value import here would load it in every spec that reaches this module.
 */

// `@techstark/opencv-js` ships type definitions, but the WASM runtime doesn't
// perfectly match them (e.g. `pyrMeanShiftFiltering` is missing at runtime).
// We therefore use `typeof import(...)` to get the module's structural shape
// for parameter typing — good enough to satisfy `no-explicit-any` without
// pretending our subset matches the full declared API.
export type CvNs = typeof import('@techstark/opencv-js');
/** OpenCV Mat instance — created via `new cv.Mat(...)` or `cv.matFromArray(...)`. */
export type CvMat = InstanceType<CvNs['Mat']>;
