'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Loader2, Save } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';

export interface Placement {
  pageIndex: number;
  x: number;
  y: number;
  scale: number;
}

interface VisualPlacementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileBase64: string;
  totalPages: number;
  placements: Placement[];
  onSave: (placements: Placement[]) => void;
  mode: 'type' | 'draw' | 'upload';
  imagePayload: string | null;
  text: string;
  font: string;
  color: string;
  scale: number;
}

export function VisualPlacementModal({
  open,
  onOpenChange,
  fileBase64,
  totalPages,
  placements,
  onSave,
  mode,
  imagePayload,
  text,
  font,
  color,
  scale,
}: VisualPlacementModalProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep local track of placements while editing
  const [localPlacements, setLocalPlacements] = useState<Placement[]>([]);
  const [pdfScale, setPdfScale] = useState(1);

  useEffect(() => {
    if (open) {
      setLocalPlacements([...placements]);
    }
  }, [open, placements]);

  // Load PDF document
  useEffect(() => {
    if (!open || !fileBase64) return;

    let isMounted = true;
    const loadPdf = async () => {
      try {
        setIsLoading(true);
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.mjs`;

        const pdfData = atob(fileBase64);
        const bytes = new Uint8Array(pdfData.length);
        for (let i = 0; i < pdfData.length; i++) {
          bytes[i] = pdfData.charCodeAt(i);
        }

        const loadingTask = pdfjsLib.getDocument({ data: bytes });
        const pdf = await loadingTask.promise;
        if (isMounted) {
          setPdfDoc(pdf);
        }
      } catch (err: any) {
        toast.error('Failed to load PDF for visual placement');
        console.error(err);
      }
    };

    loadPdf();
    return () => {
      isMounted = false;
    };
  }, [open, fileBase64]);

  // Render current page
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    let isMounted = true;
    const renderPage = async () => {
      try {
        setIsLoading(true);
        const page = await pdfDoc.getPage(currentPage + 1);

        const viewport = page.getViewport({ scale: 1 });

        // Let the PDF be as wide as the modal to make it large enough, allow vertical scrolling
        const availableWidth = Math.min(window.innerWidth * 0.95 - 64, 1136); // max-w-1200px minus padding

        const scaleX = availableWidth / viewport.width;
        const targetScale = Math.min(scaleX, 1.5); // Cap scale at 1.5x so it doesn't get ridiculously large

        setPdfScale(targetScale);
        const scaledViewport = page.getViewport({ scale: targetScale });

        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        canvas.height = scaledViewport.height;
        canvas.width = scaledViewport.width;

        const renderContext = {
          canvasContext: context,
          viewport: scaledViewport,
        };

        await page.render(renderContext).promise;
      } catch (err) {
        console.error('Error rendering page:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    renderPage();
    return () => {
      isMounted = false;
    };
  }, [pdfDoc, currentPage]);

  const currentPlacement = localPlacements.find((p) => p.pageIndex === currentPage);

  // Default centered position if not set
  const [dragPos, setDragPos] = useState({ x: 150, y: 150 });

  useEffect(() => {
    if (currentPlacement && containerRef.current) {
      const { width, height } = containerRef.current.getBoundingClientRect();
      setDragPos({
        x: (currentPlacement.x / 100) * width,
        y: (currentPlacement.y / 100) * height,
      });
    } else if (containerRef.current) {
      const { width, height } = containerRef.current.getBoundingClientRect();
      setDragPos({ x: width / 2 - 50, y: height / 2 - 25 });
    }
  }, [currentPlacement, currentPage, isLoading]);

  const handleDragEnd = (e: any, info: any) => {
    if (!containerRef.current) return;
    const { width, height } = containerRef.current.getBoundingClientRect();

    // Convert final px position to percentages
    const newX = Math.max(0, Math.min(100, (dragPos.x / width) * 100));
    const newY = Math.max(0, Math.min(100, (dragPos.y / height) * 100));

    const existingIdx = localPlacements.findIndex((p) => p.pageIndex === currentPage);
    const newPlacement: Placement = {
      pageIndex: currentPage,
      x: newX,
      y: newY,
      scale, // Save the current scale when the user updates placement
    };

    if (existingIdx >= 0) {
      const copy = [...localPlacements];
      copy[existingIdx] = newPlacement;
      setLocalPlacements(copy);
    } else {
      setLocalPlacements([...localPlacements, newPlacement]);
    }
  };

  const handleRemoveCurrent = () => {
    setLocalPlacements((prev) => prev.filter((p) => p.pageIndex !== currentPage));
  };

  const handleSave = () => {
    // If there's no placement for the current page but the user moved the signature, auto-add it?
    // The handleDragEnd automatically adds it.
    onSave(localPlacements);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-[1000px] sm:max-w-[1000px] h-[95vh] max-h-[95vh] bg-white/80 backdrop-blur-md overflow-hidden flex flex-col p-4">
        <DialogHeader className="mb-2 shrink-0">
          <DialogTitle>Visual Signature Placement</DialogTitle>
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0 || isLoading}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium">
                Page {currentPage + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage === totalPages - 1 || isLoading}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {currentPlacement && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRemoveCurrent}
                className="text-muted-foreground"
              >
                Remove from this page
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="relative flex-1 overflow-auto flex items-center justify-center bg-muted/40 border rounded-lg">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10 backdrop-blur-md">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          <div ref={containerRef} className="relative shadow-sm bg-white overflow-hidden shrink-0">
            <canvas ref={canvasRef} className="block w-full h-auto" />

            {!isLoading && (
              <motion.div
                drag
                dragMomentum={false}
                dragConstraints={containerRef}
                onDrag={(e, info) => {
                  setDragPos({ x: dragPos.x + info.delta.x, y: dragPos.y + info.delta.y });
                }}
                onDragEnd={handleDragEnd}
                style={{
                  x: dragPos.x,
                  y: dragPos.y,
                  scale: (scale / 100) * pdfScale,
                  transformOrigin: 'top left',
                }}
                className="absolute top-0 left-0 cursor-move border border-primary/50 border-dashed hover:border-primary transition-colors w-max"
              >
                {mode === 'type' ? (
                  <span
                    style={{
                      fontFamily: font === 'Cursive' ? 'cursive' : 'sans-serif',
                      color: color === 'black' ? '#000' : color === 'blue' ? '#0000ff' : '#ff0000',
                      fontSize: '24px',
                      lineHeight: 1,
                      display: 'block',
                    }}
                  >
                    {text || 'Your Signature'}
                  </span>
                ) : imagePayload ? (
                  <img
                    src={imagePayload}
                    alt="Signature"
                    className="max-h-[60px] pointer-events-none"
                  />
                ) : (
                  <span className="text-muted-foreground text-sm">No signature</span>
                )}
              </motion.div>
            )}
          </div>
        </div>

        <DialogFooter className="mt-4 shrink-0 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {localPlacements.length} placement(s) set.
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              <Save className="h-4 w-4 mr-2" />
              Save Placements
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
