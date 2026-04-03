import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, IconButton, Slider, Tooltip, Button, Typography, Divider, ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import FormatPaintIcon from '@mui/icons-material/FormatPaint';
import AutoFixOffIcon from '@mui/icons-material/AutoFixOff';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import TimelineIcon from '@mui/icons-material/Timeline';
import {
  floodFillFromSource, hexToRgb, rgbToHex,
  parseRgbString, getDistinctColor, computeClusterPercentages,
} from './clusterPaintUtils';
import type { PaletteEntry } from './clusterPaintUtils';
import type { BorderPath, ClusterReviewCluster, ManualClusterResponse } from '../../api/adminWvImportCvMatch';
import {
  pointsToSmoothSvgPath, findOpenEndpoints, rasterizeBorderPaths,
  findEraserIntersection,
} from './svgBorderUtils';
import type { OpenEndpoint } from './svgBorderUtils';

type Tool = 'fill' | 'eraser' | 'line';

interface Props {
  sourceImageUrl: string;
  originalImageUrl?: string;
  borderPaths?: BorderPath[];
  pipelineSize?: { w: number; h: number };
  overlayImageUrl?: string;
  initialClusters?: ClusterReviewCluster[];
  onConfirm: (response: ManualClusterResponse) => void;
  onCancel: () => void;
}

interface Snapshot {
  paths: BorderPath[];
  colorData: ImageData | null;
}

const MAX_HISTORY = 50;
const SNAP_DISTANCE = 15;

export default function ClusterPaintEditor({
  sourceImageUrl, originalImageUrl, borderPaths, pipelineSize, overlayImageUrl, initialClusters,
  onConfirm, onCancel,
}: Props) {
  // --- Refs ---
  const wrapperRef = useRef<HTMLDivElement>(null);
  const colorCanvasRef = useRef<HTMLCanvasElement>(null);

  // --- State ---
  const [tool, setTool] = useState<Tool>('fill');
  const [paths, setPaths] = useState<BorderPath[]>(borderPaths ?? []);
  const [polyPoints, setPolyPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [palette, setPalette] = useState<PaletteEntry[]>([]);
  const [activeLabel, setActiveLabel] = useState<number>(-1);
  const [pcts, setPcts] = useState<Map<number, number>>(new Map());
  const [eraserSize, setEraserSize] = useState(15);
  const [fillTolerance, setFillTolerance] = useState(30);
  const [borderOpacity, setBorderOpacity] = useState(100);
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [bgMode, setBgMode] = useState<'processed' | 'original'>('processed');
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [snapTarget, setSnapTarget] = useState<OpenEndpoint | null>(null);

  // Undo/redo
  const historyRef = useRef<Snapshot[]>([]);
  const historyIdxRef = useRef(-1);

  // Refs for stable callbacks
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const pathsRef = useRef(paths);
  pathsRef.current = paths;
  const polyPointsRef = useRef(polyPoints);
  polyPointsRef.current = polyPoints;

  // --- Pipeline dimensions (from backend, or derived from border paths) ---
  const pipelineDims = useMemo(() => {
    if (pipelineSize) return pipelineSize;
    // Fallback: derive from border path bounds
    let maxX = 0, maxY = 0;
    for (const p of (borderPaths ?? [])) {
      for (const [x, y] of p.points) {
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    return { w: maxX > 0 ? Math.ceil(maxX) + 1 : 500, h: maxY > 0 ? Math.ceil(maxY) + 1 : 500 };
  }, [pipelineSize, borderPaths]);

  // --- Open endpoints for SVG rendering ---
  const openEndpoints = useMemo(() => findOpenEndpoints(paths), [paths]);

  // --- Initialize palette from CV clusters ---
  useEffect(() => {
    if (initialClusters && initialClusters.length > 0) {
      const entries: PaletteEntry[] = initialClusters.map(c => ({
        label: c.label,
        color: parseRgbString(c.color),
      }));
      setPalette(entries);
      setActiveLabel(entries[0].label);
    }
  }, [initialClusters]);

  // --- Load source image to get canvas size ---
  useEffect(() => {
    const img = new Image();
    img.onload = () => setCanvasSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = sourceImageUrl;
  }, [sourceImageUrl]);

  // --- Percentage update helper ---
  const updatePercentages = useCallback(() => {
    const cc = colorCanvasRef.current;
    if (!cc || paletteRef.current.length === 0) return;
    const ctx = cc.getContext('2d')!;
    const data = ctx.getImageData(0, 0, cc.width, cc.height);
    setPcts(computeClusterPercentages(data, paletteRef.current));
  }, []);

  // --- Undo/redo ---
  const saveSnapshot = useCallback(() => {
    const cc = colorCanvasRef.current;
    const colorData = cc ? cc.getContext('2d')!.getImageData(0, 0, cc.width, cc.height) : null;
    const snap: Snapshot = { paths: structuredClone(pathsRef.current), colorData };
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
    historyRef.current.push(snap);
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    historyIdxRef.current = historyRef.current.length - 1;
    updatePercentages();
  }, [updatePercentages]);

  const restoreSnapshot = useCallback((idx: number) => {
    const snap = historyRef.current[idx];
    if (!snap) return;
    setPaths(snap.paths);
    if (snap.colorData) {
      colorCanvasRef.current?.getContext('2d')!.putImageData(snap.colorData, 0, 0);
    }
    updatePercentages();
  }, [updatePercentages]);

  const undo = useCallback(() => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current--;
    restoreSnapshot(historyIdxRef.current);
  }, [restoreSnapshot]);

  const redo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current++;
    restoreSnapshot(historyIdxRef.current);
  }, [restoreSnapshot]);

  // --- Initialize color canvas ---
  useEffect(() => {
    const cc = colorCanvasRef.current;
    if (!cc || canvasSize.w === 0) return;
    cc.width = canvasSize.w;
    cc.height = canvasSize.h;

    if (overlayImageUrl) {
      const ovImg = new Image();
      ovImg.crossOrigin = 'anonymous';
      ovImg.onload = () => {
        cc.getContext('2d')!.drawImage(ovImg, 0, 0, canvasSize.w, canvasSize.h);
        saveSnapshot();
      };
      ovImg.onerror = () => saveSnapshot();
      ovImg.src = overlayImageUrl;
    } else {
      saveSnapshot();
    }
  }, [canvasSize.w, canvasSize.h]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Coordinate helpers ---
  const clientToPipeline = useCallback((e: React.MouseEvent | MouseEvent): { x: number; y: number } | null => {
    const cc = colorCanvasRef.current;
    if (!cc) return null;
    const rect = cc.getBoundingClientRect();
    const displayX = e.clientX - rect.left;
    const displayY = e.clientY - rect.top;
    // Convert display coords to pipeline coords
    const scaleX = pipelineDims.w / rect.width;
    const scaleY = pipelineDims.h / rect.height;
    return { x: Math.round(displayX * scaleX), y: Math.round(displayY * scaleY) };
  }, [pipelineDims]);

  const clientToCanvas = useCallback((e: React.MouseEvent): { x: number; y: number } | null => {
    const cc = colorCanvasRef.current;
    if (!cc) return null;
    const rect = cc.getBoundingClientRect();
    const scaleX = cc.width / rect.width;
    const scaleY = cc.height / rect.height;
    return { x: Math.round((e.clientX - rect.left) * scaleX), y: Math.round((e.clientY - rect.top) * scaleY) };
  }, []);

  // --- Fill handler ---
  const handleFill = useCallback((canvasX: number, canvasY: number) => {
    const cc = colorCanvasRef.current;
    if (!cc || activeLabel < 0) return;
    const entry = paletteRef.current.find(p => p.label === activeLabel);
    if (!entry) return;

    const borderImageData = rasterizeBorderPaths(
      pathsRef.current, cc.width, cc.height, pipelineDims.w, pipelineDims.h,
    );
    const colorData = cc.getContext('2d')!.getImageData(0, 0, cc.width, cc.height);
    const t0 = performance.now();
    const filled = floodFillFromSource(
      borderImageData, colorData, canvasX, canvasY,
      [entry.color[0], entry.color[1], entry.color[2], 200],
      fillTolerance,
    );
    console.log(`[Paint] Fill: ${filled} px in ${(performance.now() - t0).toFixed(0)}ms`);
    cc.getContext('2d')!.putImageData(colorData, 0, 0);
    saveSnapshot();
  }, [activeLabel, fillTolerance, pipelineDims, saveSnapshot]);

  // --- Eraser drag state ---
  const eraserDragRef = useRef(false);

  const handleEraserHit = useCallback((px: number, py: number) => {
    setPaths(prev => {
      let changed = false;
      const next: BorderPath[] = [];
      for (const path of prev) {
        const hitIdx = findEraserIntersection(px, py, eraserSize, path.points);
        if (hitIdx === null) {
          next.push(path);
          continue;
        }
        changed = true;
        const before = path.points.slice(0, hitIdx + 1);
        const after = path.points.slice(hitIdx + 1);
        if (before.length >= 2) {
          next.push({ ...path, id: `${path.id}-a`, points: before });
        }
        if (after.length >= 2) {
          next.push({ ...path, id: `${path.id}-b`, points: after });
        }
      }
      return changed ? next : prev;
    });
  }, [eraserSize]);

  // --- Polyline: finish helper ---
  const finishPolyline = useCallback((close: boolean) => {
    const pts = polyPointsRef.current;
    if (pts.length < 2) { setPolyPoints([]); return; }
    const points: Array<[number, number]> = pts.map(p => [p.x, p.y]);
    if (close && pts.length >= 3) points.push([pts[0].x, pts[0].y]);
    const newPath: BorderPath = {
      id: `user-${Date.now()}`,
      type: 'internal',
      clusters: [-1, -1],
      points,
    };
    setPaths(prev => [...prev, newPath]);
    setPolyPoints([]);
    // saveSnapshot is called after paths state update via effect
    setTimeout(() => saveSnapshot(), 0);
  }, [saveSnapshot]);

  // --- Canvas click handler (fill + polyline) ---
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool === 'fill') {
      const canvasCoords = clientToCanvas(e);
      if (!canvasCoords) return;
      handleFill(canvasCoords.x, canvasCoords.y);
    } else if (tool === 'line') {
      const pipeCoords = clientToPipeline(e);
      if (!pipeCoords) return;
      const { x, y } = pipeCoords;
      const pts = polyPointsRef.current;

      // Check auto-snap to open endpoints
      let snappedX = x, snappedY = y;
      const nearEp = openEndpoints.find(ep => {
        const dx = ep.x - x, dy = ep.y - y;
        return Math.sqrt(dx * dx + dy * dy) < SNAP_DISTANCE;
      });
      if (nearEp) { snappedX = nearEp.x; snappedY = nearEp.y; }

      // Close polygon if clicking near first point (>= 3 points)
      if (pts.length >= 3) {
        const first = pts[0];
        const dx = snappedX - first.x, dy = snappedY - first.y;
        if (Math.sqrt(dx * dx + dy * dy) < SNAP_DISTANCE) {
          finishPolyline(true);
          return;
        }
      }
      setPolyPoints(prev => [...prev, { x: snappedX, y: snappedY }]);
    }
  }, [tool, clientToCanvas, clientToPipeline, handleFill, openEndpoints, finishPolyline]);

  // --- SVG mouse handlers (eraser) ---
  const handleSvgMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (tool !== 'eraser') return;
    eraserDragRef.current = true;
    const pipeCoords = clientToPipeline(e);
    if (pipeCoords) handleEraserHit(pipeCoords.x, pipeCoords.y);
  }, [tool, clientToPipeline, handleEraserHit]);

  const handleSvgMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (tool !== 'eraser' || !eraserDragRef.current) return;
    const pipeCoords = clientToPipeline(e);
    if (pipeCoords) handleEraserHit(pipeCoords.x, pipeCoords.y);
  }, [tool, clientToPipeline, handleEraserHit]);

  const handleSvgMouseUp = useCallback(() => {
    if (eraserDragRef.current) {
      eraserDragRef.current = false;
      saveSnapshot();
    }
  }, [saveSnapshot]);

  // --- Polyline snap target tracking ---
  const handleLayerMouseMove = useCallback((e: React.MouseEvent) => {
    if (tool !== 'line' || polyPointsRef.current.length === 0) { setSnapTarget(null); return; }
    const pipeCoords = clientToPipeline(e);
    if (!pipeCoords) return;
    const near = openEndpoints.find(ep => {
      const dx = ep.x - pipeCoords.x, dy = ep.y - pipeCoords.y;
      return Math.sqrt(dx * dx + dy * dy) < SNAP_DISTANCE;
    });
    setSnapTarget(near ?? null);
  }, [tool, clientToPipeline, openEndpoints]);

  // --- Keyboard shortcuts ---
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'f' || e.key === 'F') { setTool('fill'); e.preventDefault(); return; }
    if (e.key === 'e' || e.key === 'E') { setTool('eraser'); e.preventDefault(); return; }
    if (e.key === 'l' || e.key === 'L') { setTool('line'); setPolyPoints([]); e.preventDefault(); return; }
    if (e.key === 'Escape') { setPolyPoints([]); return; }
    if (e.key === 'Enter' && tool === 'line') { finishPolyline(false); e.preventDefault(); return; }
    if (e.key === 'z' && mod && !e.shiftKey) { undo(); e.preventDefault(); return; }
    if ((e.key === 'z' && mod && e.shiftKey) || (e.key === 'Z' && mod)) { redo(); e.preventDefault(); return; }
    if (e.key === '[') { setEraserSize(s => Math.max(1, s - 2)); return; }
    if (e.key === ']') { setEraserSize(s => Math.min(100, s + 2)); return; }
    if (e.key === ' ') { setIsPanning(true); e.preventDefault(); return; }
    const digit = parseInt(e.key);
    if (digit >= 1 && digit <= paletteRef.current.length) setActiveLabel(paletteRef.current[digit - 1].label);
  }, [undo, redo, finishPolyline, tool]);

  useEffect(() => {
    const upHandler = (e: KeyboardEvent) => { if (e.key === ' ') setIsPanning(false); };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', upHandler);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', upHandler); };
  }, [handleKeyDown]);

  // --- Zoom (native listener, passive: false) ---
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      setZoom(z => Math.min(5, Math.max(0.25, z + (e.deltaY > 0 ? -0.1 : 0.1))));
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // --- Pan ---
  const panRef = useRef({ startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });
  const handlePanStart = useCallback((e: React.MouseEvent) => {
    if (!isPanning || !wrapperRef.current) return;
    const el = wrapperRef.current;
    panRef.current = { startX: e.clientX, startY: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop };
  }, [isPanning]);
  const handlePanMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning || !wrapperRef.current || e.buttons === 0) return;
    const el = wrapperRef.current;
    el.scrollLeft = panRef.current.scrollLeft - (e.clientX - panRef.current.startX);
    el.scrollTop = panRef.current.scrollTop - (e.clientY - panRef.current.startY);
  }, [isPanning]);

  // --- Palette management ---
  const addCluster = useCallback(() => {
    const nextLabel = palette.length > 0 ? Math.max(...palette.map(p => p.label)) + 1 : 0;
    const color = hexToRgb(getDistinctColor(nextLabel));
    setPalette(prev => [...prev, { label: nextLabel, color }]);
    setActiveLabel(nextLabel);
  }, [palette]);

  const removeCluster = useCallback((label: number) => {
    const cc = colorCanvasRef.current;
    if (cc) {
      const ctx = cc.getContext('2d')!;
      const data = ctx.getImageData(0, 0, cc.width, cc.height);
      const entry = palette.find(p => p.label === label);
      if (entry) {
        for (let i = 0; i < data.data.length; i += 4) {
          if (Math.abs(data.data[i] - entry.color[0]) < 10 &&
              Math.abs(data.data[i + 1] - entry.color[1]) < 10 &&
              Math.abs(data.data[i + 2] - entry.color[2]) < 10 &&
              data.data[i + 3] > 0) {
            data.data[i + 3] = 0;
          }
        }
        ctx.putImageData(data, 0, 0);
        saveSnapshot();
      }
    }
    setPalette(prev => prev.filter(p => p.label !== label));
    if (activeLabel === label) {
      const remaining = palette.filter(p => p.label !== label);
      setActiveLabel(remaining.length > 0 ? remaining[0].label : -1);
    }
  }, [palette, activeLabel, saveSnapshot]);

  // --- Submit ---
  const handleConfirm = useCallback(() => {
    const cc = colorCanvasRef.current;
    if (!cc || palette.length === 0) return;
    onConfirm({
      type: 'manual_clusters',
      overlayPng: cc.toDataURL('image/png'),
      palette: palette.map(p => ({ label: p.label, color: p.color })),
    });
  }, [palette, onConfirm]);

  // --- Cursors ---
  let wrapperCursor = 'default';
  if (isPanning) wrapperCursor = 'grab';
  else if (tool === 'fill' || tool === 'line') wrapperCursor = 'crosshair';
  else if (tool === 'eraser') wrapperCursor = 'crosshair';

  // --- Background image URL ---
  const bgUrl = bgMode === 'original' && originalImageUrl ? originalImageUrl : sourceImageUrl;

  // --- Render ---
  return (
    <Box sx={{ display: 'flex', height: '70vh', border: '2px solid', borderColor: 'info.main', borderRadius: 1, overflow: 'hidden' }}>
      {/* Left toolbar */}
      <Box sx={{ width: 56, bgcolor: 'grey.100', display: 'flex', flexDirection: 'column', alignItems: 'center', p: 1, gap: 0.5, borderRight: 1, borderColor: 'divider' }}>
        <Tooltip title="Paint bucket (F)" placement="right">
          <IconButton size="small" color={tool === 'fill' ? 'primary' : 'default'} onClick={() => setTool('fill')}>
            <FormatPaintIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Erase border (E)" placement="right">
          <IconButton size="small" color={tool === 'eraser' ? 'primary' : 'default'} onClick={() => setTool('eraser')}>
            <AutoFixOffIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Draw border (L)" placement="right">
          <IconButton size="small" color={tool === 'line' ? 'primary' : 'default'} onClick={() => { setTool('line'); setPolyPoints([]); }}>
            <TimelineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Divider flexItem sx={{ my: 0.5 }} />
        <Tooltip title="Undo (Ctrl+Z)" placement="right">
          <IconButton size="small" onClick={undo}><UndoIcon fontSize="small" /></IconButton>
        </Tooltip>
        <Tooltip title="Redo (Ctrl+Shift+Z)" placement="right">
          <IconButton size="small" onClick={redo}><RedoIcon fontSize="small" /></IconButton>
        </Tooltip>
        <Divider flexItem sx={{ my: 0.5 }} />
        <Typography variant="caption" color="text.secondary">Eraser</Typography>
        <Slider orientation="vertical" size="small" min={1} max={60} value={eraserSize}
          onChange={(_, v) => setEraserSize(v as number)} sx={{ height: 80 }} />
        <Typography variant="caption">{eraserSize}px</Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">Fill tol.</Typography>
        <Slider orientation="vertical" size="small" min={0} max={100} value={fillTolerance}
          onChange={(_, v) => setFillTolerance(v as number)} sx={{ height: 60 }} />
        <Typography variant="caption">{fillTolerance}</Typography>
      </Box>

      {/* Center layer stack */}
      <Box ref={wrapperRef} onMouseDown={handlePanStart} onMouseMove={(e) => { handlePanMove(e); handleLayerMouseMove(e); }}
        sx={{ flex: 1, overflow: 'auto', position: 'relative', bgcolor: '#1a1a2e', cursor: wrapperCursor }}>
        <Box sx={{ transform: `scale(${zoom})`, transformOrigin: '0 0', position: 'relative', width: canvasSize.w, height: canvasSize.h }}>
          {/* Layer 1: Background image */}
          <img src={bgUrl} alt="Map background"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />

          {/* Layer 2: SVG border overlay */}
          <svg
            viewBox={`0 0 ${pipelineDims.w} ${pipelineDims.h}`}
            style={{
              position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
              opacity: borderOpacity / 100,
              pointerEvents: tool === 'eraser' ? 'auto' : 'none',
            }}
            onMouseDown={handleSvgMouseDown}
            onMouseMove={handleSvgMouseMove}
            onMouseUp={handleSvgMouseUp}
          >
            {paths.map(p => (
              <path key={p.id} d={pointsToSmoothSvgPath(p.points)}
                stroke={p.type === 'internal' ? 'rgb(21,101,192)' : 'rgb(213,47,47)'}
                strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {openEndpoints.map(ep => (
              <circle key={`${ep.pathId}-${ep.end}`} cx={ep.x} cy={ep.y}
                r={snapTarget?.pathId === ep.pathId && snapTarget?.end === ep.end ? 6 : 4}
                fill="#ff6600" stroke="white" strokeWidth={1.5} />
            ))}
            {/* Polyline preview */}
            {tool === 'line' && polyPoints.length > 0 && (
              <polyline
                points={polyPoints.map(p => `${p.x},${p.y}`).join(' ')}
                stroke="rgb(21,101,192)" strokeWidth={3} fill="none"
                strokeLinecap="round" strokeLinejoin="round" strokeDasharray="8 4"
                style={{ pointerEvents: 'none' }}
              />
            )}
          </svg>

          {/* Layer 3: Color canvas */}
          <canvas ref={colorCanvasRef} onClick={handleCanvasClick}
            style={{
              position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
              opacity: 0.55, cursor: wrapperCursor,
              pointerEvents: (tool === 'fill' || tool === 'line') ? 'auto' : 'none',
            }} />
        </Box>
        <Typography variant="caption"
          sx={{ position: 'absolute', bottom: 8, right: 8, bgcolor: 'rgba(0,0,0,0.6)', color: '#ccc', px: 1, borderRadius: 1 }}>
          {Math.round(zoom * 100)}% — scroll to zoom, Space+drag to pan
        </Typography>
      </Box>

      {/* Right palette */}
      <Box sx={{ width: 200, bgcolor: 'grey.50', borderLeft: 1, borderColor: 'divider', p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5, overflowY: 'auto' }}>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1, mb: 0.5 }}>
          Clusters
        </Typography>
        {palette.map((entry, idx) => (
          <Box key={entry.label} onClick={() => setActiveLabel(entry.label)}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1, p: 0.75, borderRadius: 1, cursor: 'pointer',
              border: '2px solid', borderColor: entry.label === activeLabel ? 'primary.main' : 'transparent',
              bgcolor: entry.label === activeLabel ? 'primary.50' : 'transparent',
              '&:hover': { bgcolor: 'grey.200' },
            }}>
            <Box sx={{
              width: 24, height: 24, borderRadius: 0.5, flexShrink: 0,
              bgcolor: rgbToHex(...entry.color),
              border: entry.label === activeLabel ? '2px solid white' : undefined,
              boxShadow: entry.label === activeLabel ? '0 0 0 1px rgba(0,0,0,0.3)' : undefined,
            }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap>Cluster {idx + 1}</Typography>
              <Typography variant="caption" color="text.secondary">
                {pcts.get(entry.label)?.toFixed(1) ?? '0.0'}%
              </Typography>
            </Box>
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); removeCluster(entry.label); }}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        ))}
        <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={addCluster} sx={{ mt: 0.5 }}>
          Add cluster
        </Button>
        <Box sx={{ flex: 1 }} />
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary">Border opacity</Typography>
          <Slider size="small" min={0} max={100} value={borderOpacity}
            onChange={(_, v) => setBorderOpacity(v as number)} />
        </Box>
        {originalImageUrl && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>Background</Typography>
            <ToggleButtonGroup size="small" exclusive value={bgMode}
              onChange={(_, val) => { if (val) setBgMode(val); }} fullWidth>
              <ToggleButton value="processed" sx={{ textTransform: 'none', fontSize: 11 }}>Processed</ToggleButton>
              <ToggleButton value="original" sx={{ textTransform: 'none', fontSize: 11 }}>Original</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        )}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
          <Button variant="contained" color="info" size="small" disabled={palette.length === 0} onClick={handleConfirm}>
            Confirm clusters
          </Button>
          <Button variant="outlined" size="small" color="inherit" onClick={onCancel}>
            Back to review
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
