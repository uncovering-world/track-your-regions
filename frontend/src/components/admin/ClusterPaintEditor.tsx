import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, IconButton, Slider, Tooltip, Button, Typography, Divider,
} from '@mui/material';
import FormatPaintIcon from '@mui/icons-material/FormatPaint';
import BrushIcon from '@mui/icons-material/Brush';
import AutoFixOffIcon from '@mui/icons-material/AutoFixOff';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import TimelineIcon from '@mui/icons-material/Timeline';
import Atrament, { MODE_DRAW, MODE_ERASE, MODE_DISABLED } from 'atrament';
import {
  floodFillFromSource, hexToRgb, rgbToHex,
  parseRgbString, getDistinctColor, computeClusterPercentages,
} from './clusterPaintUtils';
import type { PaletteEntry } from './clusterPaintUtils';
import type { ClusterReviewCluster, ManualClusterResponse } from '../../api/adminWvImportCvMatch';

type Tool = 'fill' | 'brush' | 'eraser' | 'line';

/** Border drawing color — must match CV pipeline internal border in wvImportMatchClusterClean.ts */
const BORDER_DRAW_COLOR = 'rgb(21, 101, 192)';
/** Fixed border width — matches CV pipeline border (~1px at TW=500, upscaled ~5px at display res) */
const BORDER_LINE_WIDTH = 5;

interface Props {
  /** Processed (mean-shift) image — loaded onto the editable border canvas */
  sourceImageUrl: string;
  /** Original unprocessed map — shown as background behind border canvas */
  originalImageUrl?: string;
  /** Existing cluster overlay (fix mode) — loaded onto color canvas */
  overlayImageUrl?: string;
  initialClusters?: ClusterReviewCluster[];
  onConfirm: (response: ManualClusterResponse) => void;
  onCancel: () => void;
}

const MAX_HISTORY = 50;

export default function ClusterPaintEditor({
  sourceImageUrl, originalImageUrl, overlayImageUrl, initialClusters, onConfirm, onCancel,
}: Props) {
  // ─── Refs ───
  const wrapperRef = useRef<HTMLDivElement>(null);
  const borderCanvasRef = useRef<HTMLCanvasElement>(null);  // editable: processed image + border edits
  const colorCanvasRef = useRef<HTMLCanvasElement>(null);   // editable: cluster color fills only
  const atramentRef = useRef<Atrament | null>(null);

  // ─── State ───
  const [tool, setTool] = useState<Tool>('fill');
  const [brushSize, setBrushSize] = useState(5);
  const [fillTolerance, setFillTolerance] = useState(30);
  const [borderOpacity, setBorderOpacity] = useState(100);
  const [zoom, setZoom] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [palette, setPalette] = useState<PaletteEntry[]>([]);
  const [activeLabel, setActiveLabel] = useState<number>(-1);
  const [pcts, setPcts] = useState<Map<number, number>>(new Map());
  const [isPanning, setIsPanning] = useState(false);
  const [polyPoints, setPolyPoints] = useState<Array<{ x: number; y: number }>>([]);

  // Undo/redo: snapshots of BOTH canvases
  const historyRef = useRef<Array<{ border: ImageData; color: ImageData }>>([]);
  const historyIdxRef = useRef(-1);

  // Refs for stable callbacks
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const polyPointsRef = useRef(polyPoints);
  polyPointsRef.current = polyPoints;

  // ─── Initialize palette from CV clusters (fix mode) ───
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

  // ─── Load processed image → set canvas size ───
  useEffect(() => {
    const img = new Image();
    img.onload = () => setCanvasSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = sourceImageUrl;
  }, [sourceImageUrl]);

  // ─── Undo/redo helpers ───
  const updatePercentages = useCallback(() => {
    const cc = colorCanvasRef.current;
    if (!cc || paletteRef.current.length === 0) return;
    const ctx = cc.getContext('2d')!;
    const data = ctx.getImageData(0, 0, cc.width, cc.height);
    setPcts(computeClusterPercentages(data, paletteRef.current));
  }, []);

  const saveSnapshot = useCallback(() => {
    const bc = borderCanvasRef.current;
    const cc = colorCanvasRef.current;
    if (!bc || !cc) return;
    const snap = {
      border: bc.getContext('2d')!.getImageData(0, 0, bc.width, bc.height),
      color: cc.getContext('2d')!.getImageData(0, 0, cc.width, cc.height),
    };
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
    historyRef.current.push(snap);
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    historyIdxRef.current = historyRef.current.length - 1;
    updatePercentages();
  }, [updatePercentages]);

  const restoreSnapshot = useCallback((idx: number) => {
    const snap = historyRef.current[idx];
    if (!snap) return;
    borderCanvasRef.current?.getContext('2d')!.putImageData(snap.border, 0, 0);
    colorCanvasRef.current?.getContext('2d')!.putImageData(snap.color, 0, 0);
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

  // ─── Initialize canvases ───
  useEffect(() => {
    const bc = borderCanvasRef.current;
    const cc = colorCanvasRef.current;
    if (!bc || !cc || canvasSize.w === 0) return;
    bc.width = canvasSize.w; bc.height = canvasSize.h;
    cc.width = canvasSize.w; cc.height = canvasSize.h;

    // Load processed image onto border canvas
    const procImg = new Image();
    procImg.onload = () => {
      bc.getContext('2d')!.drawImage(procImg, 0, 0, canvasSize.w, canvasSize.h);

      // Load overlay onto color canvas (fix mode)
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
    };
    procImg.src = sourceImageUrl;

    // Atrament on BORDER canvas (brush/eraser edit borders directly)
    const at = new Atrament(bc, { color: BORDER_DRAW_COLOR });
    at.weight = brushSize;
    at.smoothing = 0.5;
    at.adaptiveStroke = false;
    at.mode = MODE_DISABLED;
    atramentRef.current = at;
    at.addEventListener('strokeend', () => saveSnapshot());

    return () => { at.destroy(); atramentRef.current = null; };
  }, [canvasSize.w, canvasSize.h]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Sync tool → Atrament mode ───
  useEffect(() => {
    const at = atramentRef.current;
    if (!at) return;
    if (tool === 'brush') {
      at.mode = MODE_DRAW;
      at.color = BORDER_DRAW_COLOR;
      at.weight = BORDER_LINE_WIDTH; // fixed width, matches CV pipeline
    } else if (tool === 'eraser') {
      at.mode = MODE_ERASE;
      at.weight = brushSize; // eraser size is adjustable
    } else {
      at.mode = MODE_DISABLED;
      if (tool !== 'line') setPolyPoints([]);
    }
  }, [tool, brushSize]);

  // ─── Polyline/polygon border tool ───
  const closeDist = 12 / Math.max(zoom, 0.25);

  /** Draw border path on border canvas with fixed style, resetting any Atrament state */
  const drawBorderPath = useCallback((ctx: CanvasRenderingContext2D, pts: Array<{ x: number; y: number }>, close: boolean) => {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over'; // reset from eraser's destination-out
    ctx.globalAlpha = 1;
    ctx.strokeStyle = BORDER_DRAW_COLOR;
    ctx.lineWidth = BORDER_LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (close) ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }, []);

  /** Finish polyline: close=true if clicking near start, close=false for open polyline (Enter) */
  const finishPolyline = useCallback((close: boolean) => {
    const pts = polyPointsRef.current;
    if (pts.length < 2) return;
    const bc = borderCanvasRef.current;
    if (!bc) return;
    drawBorderPath(bc.getContext('2d')!, pts, close);
    setPolyPoints([]);
    saveSnapshot();
  }, [drawBorderPath, saveSnapshot]);

  // ─── Canvas click: fill or polygon ───
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const cc = colorCanvasRef.current;
    const bc = borderCanvasRef.current;
    if (!cc || !bc) return;
    const rect = cc.getBoundingClientRect();
    const scaleX = cc.width / rect.width;
    const scaleY = cc.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);

    if (tool === 'fill') {
      if (activeLabel < 0) return;
      const entry = paletteRef.current.find(p => p.label === activeLabel);
      if (!entry) return;
      const borderData = bc.getContext('2d')!.getImageData(0, 0, bc.width, bc.height);
      const colorData = cc.getContext('2d')!.getImageData(0, 0, cc.width, cc.height);
      const t0 = performance.now();
      const filled = floodFillFromSource(
        borderData, colorData, x, y,
        [entry.color[0], entry.color[1], entry.color[2], 200],
        fillTolerance,
      );
      console.log(`[Paint] Fill: ${filled} px in ${(performance.now() - t0).toFixed(0)}ms`);
      cc.getContext('2d')!.putImageData(colorData, 0, 0);
      saveSnapshot();
    } else if (tool === 'line') {
      // Close polygon if clicking near the first point (>= 3 points)
      if (polyPoints.length >= 3) {
        const first = polyPoints[0];
        const dx = x - first.x, dy = y - first.y;
        if (Math.sqrt(dx * dx + dy * dy) < closeDist) {
          finishPolyline(true); // closed polygon
          return;
        }
      }
      setPolyPoints(prev => [...prev, { x, y }]);
    }
  }, [tool, activeLabel, fillTolerance, polyPoints, saveSnapshot, finishPolyline, closeDist]);

  // ─── Polygon preview on mouse move ───
  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== 'line' || polyPoints.length === 0) return;
    const bc = borderCanvasRef.current;
    if (!bc) return;
    const rect = bc.getBoundingClientRect();
    const scaleX = bc.width / rect.width;
    const scaleY = bc.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);

    // Restore border canvas from last snapshot, then draw preview
    const ctx = bc.getContext('2d')!;
    const idx = historyIdxRef.current;
    if (idx >= 0) ctx.putImageData(historyRef.current[idx].border, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = BORDER_DRAW_COLOR;
    ctx.lineWidth = BORDER_LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(polyPoints[0].x, polyPoints[0].y);
    for (let i = 1; i < polyPoints.length; i++) ctx.lineTo(polyPoints[i].x, polyPoints[i].y);
    ctx.lineTo(x, y);
    ctx.stroke();
    // Close indicator: circle at first point when near enough
    if (polyPoints.length >= 3) {
      const first = polyPoints[0];
      const dx = x - first.x, dy = y - first.y;
      if (Math.sqrt(dx * dx + dy * dy) < closeDist) {
        ctx.fillStyle = BORDER_DRAW_COLOR;
        ctx.beginPath();
        ctx.arc(first.x, first.y, closeDist, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }, [tool, polyPoints, closeDist]);

  // ─── Keyboard shortcuts ───
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'f' || e.key === 'F') { setTool('fill'); e.preventDefault(); return; }
    if (e.key === 'b' || e.key === 'B') { setTool('brush'); e.preventDefault(); return; }
    if (e.key === 'e' || e.key === 'E') { setTool('eraser'); e.preventDefault(); return; }
    if (e.key === 'l' || e.key === 'L') { setTool('line'); setPolyPoints([]); e.preventDefault(); return; }
    if (e.key === 'Escape') { setPolyPoints([]); return; }
    if (e.key === 'Enter' && tool === 'line') { finishPolyline(false); e.preventDefault(); return; }
    if (e.key === 'z' && mod && !e.shiftKey) { undo(); e.preventDefault(); return; }
    if ((e.key === 'z' && mod && e.shiftKey) || (e.key === 'Z' && mod)) { redo(); e.preventDefault(); return; }
    if (e.key === '[') { setBrushSize(s => Math.max(1, s - 2)); return; }
    if (e.key === ']') { setBrushSize(s => Math.min(100, s + 2)); return; }
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

  // ─── Zoom (native listener, passive: false) ───
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

  // ─── Pan ───
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

  // ─── Palette management ───
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

  // ─── Submit: send color canvas as overlay PNG ───
  const handleConfirm = useCallback(() => {
    const cc = colorCanvasRef.current;
    if (!cc || palette.length === 0) return;
    onConfirm({
      type: 'manual_clusters',
      overlayPng: cc.toDataURL('image/png'),
      palette: palette.map(p => ({ label: p.label, color: p.color })),
    });
  }, [palette, onConfirm]);

  // ─── Cursors ───
  let wrapperCursor = 'default';
  if (isPanning) wrapperCursor = 'grab';
  else if (tool === 'fill' || tool === 'line') wrapperCursor = 'crosshair';

  // ─── Render ───
  return (
    <Box sx={{ display: 'flex', height: '70vh', border: '2px solid', borderColor: 'info.main', borderRadius: 1, overflow: 'hidden' }}>
      {/* ═══ Left toolbar ═══ */}
      <Box sx={{ width: 56, bgcolor: 'grey.100', display: 'flex', flexDirection: 'column', alignItems: 'center', p: 1, gap: 0.5, borderRight: 1, borderColor: 'divider' }}>
        <Tooltip title="Paint bucket (F)" placement="right">
          <IconButton size="small" color={tool === 'fill' ? 'primary' : 'default'} onClick={() => setTool('fill')}>
            <FormatPaintIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Draw border (B)" placement="right">
          <IconButton size="small" color={tool === 'brush' ? 'primary' : 'default'} onClick={() => setTool('brush')}>
            <BrushIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Erase border (E)" placement="right">
          <IconButton size="small" color={tool === 'eraser' ? 'primary' : 'default'} onClick={() => setTool('eraser')}>
            <AutoFixOffIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Border polygon (L)" placement="right">
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
        <Slider orientation="vertical" size="small" min={1} max={60} value={brushSize}
          onChange={(_, v) => setBrushSize(v as number)} sx={{ height: 80 }} />
        <Typography variant="caption">{brushSize}px</Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">Fill tol.</Typography>
        <Slider orientation="vertical" size="small" min={0} max={100} value={fillTolerance}
          onChange={(_, v) => setFillTolerance(v as number)} sx={{ height: 60 }} />
        <Typography variant="caption">{fillTolerance}</Typography>
      </Box>

      {/* ═══ Center canvas stack ═══ */}
      <Box ref={wrapperRef} onMouseDown={handlePanStart} onMouseMove={handlePanMove}
        sx={{ flex: 1, overflow: 'auto', position: 'relative', bgcolor: '#1a1a2e', cursor: wrapperCursor }}>
        <Box sx={{ transform: `scale(${zoom})`, transformOrigin: '0 0', position: 'relative', width: canvasSize.w, height: canvasSize.h }}>
          {/* Layer 1: Original image (background, non-editable) */}
          {originalImageUrl && (
            <img src={originalImageUrl} alt="Original map"
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
          )}
          {/* Layer 2: Border canvas (processed image, editable — brush/eraser/polygon) */}
          <canvas ref={borderCanvasRef} onMouseMove={handleCanvasMouseMove}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
              opacity: borderOpacity / 100, pointerEvents: (tool === 'brush' || tool === 'eraser') ? 'auto' : 'none' }} />
          {/* Layer 3: Color canvas (cluster fills, semi-transparent) */}
          <canvas ref={colorCanvasRef} onClick={handleCanvasClick} onMouseMove={handleCanvasMouseMove}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
              opacity: 0.55, cursor: wrapperCursor,
              pointerEvents: (tool === 'fill' || tool === 'line') ? 'auto' : 'none' }} />
        </Box>
        <Typography variant="caption"
          sx={{ position: 'absolute', bottom: 8, right: 8, bgcolor: 'rgba(0,0,0,0.6)', color: '#ccc', px: 1, borderRadius: 1 }}>
          {Math.round(zoom * 100)}% — scroll to zoom, Space+drag to pan
        </Typography>
      </Box>

      {/* ═══ Right palette ═══ */}
      <Box sx={{ width: 200, bgcolor: 'grey.50', borderLeft: 1, borderColor: 'divider', p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5, overflowY: 'auto' }}>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1, mb: 0.5 }}>
          Clusters
        </Typography>
        {palette.map((entry, idx) => (
          <Box key={entry.label} onClick={() => setActiveLabel(entry.label)}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 0.75, borderRadius: 1, cursor: 'pointer',
              border: '2px solid', borderColor: entry.label === activeLabel ? 'primary.main' : 'transparent',
              bgcolor: entry.label === activeLabel ? 'primary.50' : 'transparent',
              '&:hover': { bgcolor: 'grey.200' } }}>
            <Box sx={{ width: 24, height: 24, borderRadius: 0.5, flexShrink: 0,
              bgcolor: rgbToHex(...entry.color),
              border: entry.label === activeLabel ? '2px solid white' : undefined,
              boxShadow: entry.label === activeLabel ? '0 0 0 1px rgba(0,0,0,0.3)' : undefined }} />
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
          <Typography variant="caption" color="text.secondary">Processed opacity</Typography>
          <Slider size="small" min={0} max={100} value={borderOpacity}
            onChange={(_, v) => setBorderOpacity(v as number)} />
        </Box>
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
