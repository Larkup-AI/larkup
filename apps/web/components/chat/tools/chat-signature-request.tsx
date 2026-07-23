import { useState, useRef, useEffect } from 'react';
import { useDocEditor } from '@/components/chat/canvas/doc-editor-provider';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, PenTool, Type, Upload, Trash2, ChevronDown, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { get, set } from 'idb-keyval';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { VisualPlacementModal, Placement } from './visual-placement-modal';

interface DetectedLocation {
  pageIndex: number;
  context: string;
}

interface SavedSignature {
  id: string;
  imagePayload: string;
  mode: 'draw' | 'upload';
}

export function ChatSignatureRequest({
  detectedLocations,
  fileName,
  mimeType,
  toolCallId,
  addToolResult,
}: {
  detectedLocations?: DetectedLocation[];
  fileName?: string;
  mimeType?: string;
  toolCallId?: string;
  addToolResult?: Function;
}) {
  const {
    sessionId,
    parsedDocument,
    updateFromToolResult,
    activeFileName,
    fileMimeType,
    fileBase64,
  } = useDocEditor();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSigned, setHasSigned] = useState(false);

  // Form State
  const [mode, setMode] = useState<'type' | 'draw' | 'upload'>('type');
  const [selectedPagesStr, setSelectedPagesStr] = useState(
    detectedLocations &&
      detectedLocations.length > 0 &&
      detectedLocations[0].pageIndex !== undefined
      ? (detectedLocations[0].pageIndex + 1).toString()
      : '1',
  );

  // Placements State
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [isVisualPlacementOpen, setIsVisualPlacementOpen] = useState(false);

  // Saved Signatures State
  const [savedSignatures, setSavedSignatures] = useState<SavedSignature[]>([]);
  const [saveSignature, setSaveSignature] = useState(false);

  // Advanced & Notes State
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<number | null>(null);
  const [locationNotes, setLocationNotes] = useState<Record<number, string>>({});

  useEffect(() => {
    get('saved_signatures').then((val) => {
      if (val) setSavedSignatures(val);
    });
  }, []);

  const saveToIDB = async (newSig: SavedSignature) => {
    const updated = [newSig, ...savedSignatures];
    setSavedSignatures(updated);
    await set('saved_signatures', updated);
  };

  const deleteSavedSignature = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedSignatures.filter((s) => s.id !== id);
    setSavedSignatures(updated);
    await set('saved_signatures', updated);
  };

  // Type State
  const [text, setText] = useState('');
  const [font, setFont] = useState('Helvetica');
  const [color, setColor] = useState('black');
  const [scale, setScale] = useState(100);

  // Default to bottom-left area of the page (which is standard for signatures)
  const [xPos, setXPos] = useState(20);
  const [yPos, setYPos] = useState(85);

  // Customization Fields
  const [date, setDate] = useState('');
  const [extraText, setExtraText] = useState('');

  // Undo/replace state
  const [base64BeforeSign, setBase64BeforeSign] = useState<string | null>(null);

  // Canvas Ref for Draw
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Upload State
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);

  const startDrawing = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
  ) => {
    setIsDrawing(true);
    draw(e);
  };

  const endDrawing = () => {
    setIsDrawing(false);
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx?.beginPath();
    }
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get coordinates
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color === 'black' ? '#000000' : color === 'blue' ? '#0000ff' : '#ff0000';

    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setUploadedImage(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const clearCanvas = () => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const handleSubmit = async (overridePlacements?: Placement[]) => {
    if (!sessionId) {
      toast.error('No active document session');
      return;
    }

    setIsSubmitting(true);
    try {
      let imagePayload: string | undefined;

      if (mode === 'draw' && canvasRef.current) {
        imagePayload = canvasRef.current.toDataURL('image/png');
      } else if (mode === 'upload' && uploadedImage) {
        imagePayload = uploadedImage;
      }

      if (mode === 'type' && !text.trim()) {
        toast.error('Please type a signature');
        setIsSubmitting(false);
        return;
      }

      if ((mode === 'draw' || mode === 'upload') && !imagePayload) {
        toast.error('Please provide a signature image');
        setIsSubmitting(false);
        return;
      }

      // Save for future use
      if (saveSignature && (mode === 'draw' || mode === 'upload') && imagePayload) {
        await saveToIDB({
          id: crypto.randomUUID(),
          imagePayload,
          mode,
        });
      }

      const parsedPages = new Set<number>();
      selectedPagesStr.split(',').forEach((part) => {
        const p = part.trim();
        if (p.includes('-')) {
          const [start, end] = p.split('-').map(Number);
          if (!isNaN(start) && !isNaN(end)) {
            for (let i = start; i <= end; i++) parsedPages.add(i - 1);
          }
        } else {
          const num = Number(p);
          if (!isNaN(num)) parsedPages.add(num - 1);
        }
      });

      let finalPlacements = overridePlacements || [...placements];
      if (finalPlacements.length === 0) {
        if (parsedPages.size === 0) parsedPages.add(0);
        Array.from(parsedPages).forEach((pIdx) => {
          finalPlacements.push({
            pageIndex: pIdx,
            x: xPos,
            y: yPos,
            scale,
          });
        });
      }

      let override = base64BeforeSign;
      if (!override && fileBase64) {
        override = fileBase64;
        setBase64BeforeSign(fileBase64);
      }

      let lastResData = null;

      for (const placement of finalPlacements) {
        const res = await fetch('/api/document/sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            signatureData: {
              mode,
              imagePayload,
              text,
              font,
              color,
              date,
              extraText,
              pageIndex: placement.pageIndex,
              placementNote: locationNotes[placement.pageIndex] || '',
              detectedContext: detectedLocations?.find((l) => l.pageIndex === placement.pageIndex)
                ?.context,
              x: placement.x,
              y: placement.y,
              scale: placement.scale / 100, // Pass scale as a multiplier
              base64Override: override, // Pass the original state to allow replacing previous signatures
            },
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(
            data.error || `Failed to sign document on page ${placement.pageIndex + 1}`,
          );
        }

        lastResData = await res.json();
        // Update override for the next placement
        if (lastResData?.document?.fileBase64) {
          override = lastResData.document.fileBase64;
        }
      }

      if (lastResData) {
        setSignedResult(lastResData.document);
        updateFromToolResult({
          sessionId,
          fields: lastResData.document.parsed.fields,
          updatedFields: lastResData.document.updatedFields,
          fileBase64: lastResData.document.fileBase64,
          pages: lastResData.document.parsed.pages,
          totalPages: lastResData.document.parsed.totalPages,
        });
      }

      setHasSigned(true);
      toast.success('Signature applied for preview. Please confirm or adjust.');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const [signedResult, setSignedResult] = useState<any>(null);

  const handleConfirm = () => {
    if (toolCallId && addToolResult) {
      addToolResult({
        toolCallId,
        result: {
          success: true,
          action: 'request_signature',
          message: 'User has successfully signed the document.',
          fileBase64: signedResult?.fileBase64,
          fields: signedResult?.parsed?.fields,
          updatedFields: signedResult?.updatedFields,
          pages: signedResult?.parsed?.pages,
          totalPages: signedResult?.parsed?.totalPages,
        },
        output: {
          success: true,
          action: 'request_signature',
          message: 'User has successfully signed the document.',
          fileBase64: signedResult?.fileBase64,
          fields: signedResult?.parsed?.fields,
          updatedFields: signedResult?.updatedFields,
          pages: signedResult?.parsed?.pages,
          totalPages: signedResult?.parsed?.totalPages,
        },
      });
    }
  };

  const handleUndo = () => {
    if (base64BeforeSign && sessionId) {
      updateFromToolResult({
        sessionId,
        fileBase64: base64BeforeSign,
        fields: parsedDocument?.fields || [],
        updatedFields: [],
        pages: parsedDocument?.pages || [],
        totalPages: parsedDocument?.totalPages || 1,
      });
    }
    setHasSigned(false);
  };

  const displayFileName = fileName || activeFileName || 'Document';
  const displayMimeType = mimeType || fileMimeType || '';
  const ext = displayFileName.split('.').pop()?.toLowerCase() || '';

  let iconPath = '/icons/image.png';
  if (
    ['csv', 'xls', 'xlsx'].includes(ext) ||
    displayMimeType.includes('excel') ||
    displayMimeType.includes('spreadsheet')
  )
    iconPath = '/icons/excel.png';
  else if (['doc', 'docx'].includes(ext) || displayMimeType.includes('word'))
    iconPath = '/icons/word.png';
  else if (['md', 'markdown'].includes(ext)) iconPath = '/icons/markdown.png';
  else if (['pdf'].includes(ext) || displayMimeType === 'application/pdf')
    iconPath = '/icons/pdf.png';
  else if (!ext) iconPath = '/icons/word.png';

  return (
    <Card className="my-4 shadow-none! bg-transparent w-full max-w-3xl border-border">
      <CardHeader className="flex flex-row items-center gap-3 space-y-0">
        <div className="size-10 shrink-0 rounded-md overflow-hidden bg-white border border-border flex items-center justify-center p-1.5 shadow-sm">
          <img src={iconPath} alt={displayFileName} className="w-full h-full object-contain" />
        </div>
        <div>
          <CardTitle className="text-lg">Signature Request</CardTitle>
          <CardDescription>
            Sign <span className="font-semibold text-foreground/80">{displayFileName}</span> to
            continue.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-2">
        {!sessionId && (
          <div className="bg-amber-50 text-amber-900 border border-amber-200 rounded-md p-3 text-xs mb-4">
            <strong>Action Required:</strong> Please click on your document in the chat to open it
            in the Canvas first. The document must be open before you can sign it.
          </div>
        )}
        {detectedLocations && detectedLocations.length > 0 && (
          <div className="bg-muted p-3 rounded-md text-sm mb-4">
            <span className="font-semibold block mb-1">Detected Placement:</span>
            {detectedLocations.map((loc, i) => (
              <div key={i} className="group mb-2 last:mb-0">
                <div className="text-muted-foreground flex justify-between items-center">
                  <span>Page {loc.pageIndex + 1}</span>
                  <div className="flex items-center space-x-2">
                    <span className="italic truncate max-w-[200px]">{loc.context}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => setEditingLocation(editingLocation === i ? null : i)}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                {editingLocation === i && (
                  <div className="mt-2">
                    <Input
                      placeholder="Add notes for placement (e.g. bottom right corner)"
                      className="h-8 text-xs bg-white"
                      value={locationNotes[i] || ''}
                      onChange={(e) => setLocationNotes({ ...locationNotes, [i]: e.target.value })}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
          <div className="grid grid-cols-2 gap-2 items-end mb-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Pages (e.g. 1, 3-5)</Label>
              <Input
                value={selectedPagesStr}
                onChange={(e) => setSelectedPagesStr(e.target.value)}
                placeholder="1"
                className="h-10 text-xs bg-white"
              />
            </div>

            <div className="flex flex-col justify-end w-full">
              <CollapsibleTrigger
                className={'mb-px'}
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 w-full justify-between bg-white text-xs px-3"
                  >
                    <span>Advanced Settings</span>
                    <ChevronDown
                      className={`h-4 w-4 transition-transform duration-200 ${
                        isAdvancedOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </Button>
                }
              />
            </div>
          </div>

          <CollapsibleContent className="space-y-4 mb-4  rounded-md p-3 bg-white/50 animate-in fade-in duration-200">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Font Style</Label>
                <Select
                  value={font}
                  onValueChange={(val) => val && setFont(val)}
                  disabled={mode !== 'type'}
                >
                  <SelectTrigger className="bg-white h-8 text-xs">
                    <SelectValue placeholder="Select font" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Helvetica">Standard</SelectItem>
                    <SelectItem value="Cursive">Cursive</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs block mb-1">Signature Color</Label>
                <div className="flex gap-2 h-8 items-center">
                  {['black', 'blue', 'red'].map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`size-5 rounded-full border ${
                        color === c ? 'ring-2 ring-primary ring-offset-1' : ''
                      }`}
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs block mb-1">Size: {scale}%</Label>
                <Slider
                  value={[scale]}
                  onValueChange={(val) => setScale(Array.isArray(val) ? val[0] : val)}
                  min={50}
                  max={200}
                  step={10}
                  className="mt-2"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Date (Optional)</Label>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-8 text-xs bg-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Position X (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={xPos}
                  onChange={(e) => setXPos(Number(e.target.value))}
                  className="h-8 text-xs bg-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Position Y (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={yPos}
                  onChange={(e) => setYPos(Number(e.target.value))}
                  className="h-8 text-xs bg-white"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Extra Text (Optional)</Label>
              <Input
                value={extraText}
                onChange={(e) => setExtraText(e.target.value)}
                placeholder="Title, Company, etc."
                className="h-8 text-xs bg-white"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>

        {savedSignatures.length > 0 && (
          <div className="space-y-2 mb-4">
            <Label className="text-xs">Saved Signatures</Label>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {savedSignatures.map((sig) => (
                <div
                  key={sig.id}
                  className="relative shrink-0 w-[100px] h-[50px] border rounded bg-white flex items-center justify-center cursor-pointer hover:border-primary group overflow-hidden"
                  onClick={() => {
                    setMode(sig.mode);
                    if (sig.mode === 'upload') setUploadedImage(sig.imagePayload);
                    else if (sig.mode === 'draw') {
                      // Hacky way to reuse drawn signature via upload flow since canvas isn't easily hydrated with data URL
                      setMode('upload');
                      setUploadedImage(sig.imagePayload);
                    }
                  }}
                >
                  <img
                    src={sig.imagePayload}
                    alt="Saved Signature"
                    className="max-h-full max-w-full object-contain"
                  />
                  <button
                    onClick={(e) => deleteSavedSignature(sig.id, e)}
                    className="absolute top-1 right-1 bg-destructive text-white rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="w-full mt-4">
          <div className="border-b border-border mb-6">
            <div className="flex items-center gap-1 -mb-px">
              {[
                { id: 'type', label: 'Type', icon: Type },
                { id: 'draw', label: 'Draw', icon: PenTool },
                { id: 'upload', label: 'Upload', icon: Upload },
              ].map((tab) => {
                const isActive = mode === tab.id;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setMode(tab.id as any)}
                    className={cn(
                      'relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors outline-none',
                      isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4" />
                    {tab.label}
                    {isActive && (
                      <motion.div
                        layoutId="signature-tab-indicator"
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full"
                        initial={false}
                        transition={{
                          type: 'spring',
                          stiffness: 500,
                          damping: 35,
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="relative">
            {mode === 'type' && (
              <div className="space-y-1.5 animate-in fade-in duration-200">
                <Label className="text-xs">Your Name</Label>
                <Input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="John Doe"
                />
              </div>
            )}

            {mode === 'draw' && (
              <div className="border rounded-md bg-white overflow-hidden touch-none relative animate-in fade-in duration-200">
                <canvas
                  ref={canvasRef}
                  width={380}
                  height={150}
                  onMouseDown={startDrawing}
                  onMouseUp={endDrawing}
                  onMouseOut={endDrawing}
                  onMouseMove={draw}
                  onTouchStart={startDrawing}
                  onTouchEnd={endDrawing}
                  onTouchMove={draw}
                  className="w-full h-[150px] cursor-crosshair block"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute bottom-2 right-2 h-7 text-xs"
                  onClick={clearCanvas}
                >
                  Clear
                </Button>
              </div>
            )}

            {mode === 'upload' && (
              <div className="border-2 border-dashed rounded-md p-6 flex flex-col items-center justify-center text-center relative overflow-hidden animate-in fade-in duration-200">
                <input
                  type="file"
                  accept="image/png, image/jpeg"
                  onChange={handleFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  id="signature-upload"
                />
                {!uploadedImage ? (
                  <div className="flex flex-col items-center space-y-2 pointer-events-none">
                    <Upload className="size-8 text-muted-foreground mb-2" />
                    <span className="text-sm font-medium">Click or drag to upload signature</span>
                    <span className="text-xs text-muted-foreground">
                      PNG or JPG with transparent background
                    </span>
                  </div>
                ) : (
                  <div className="mt-2 max-h-[100px] overflow-hidden rounded bg-white w-full flex justify-center pointer-events-none">
                    <img
                      src={uploadedImage}
                      alt="Signature Preview"
                      className="max-h-full object-contain"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {(mode === 'draw' || mode === 'upload') && (
          <div className="flex items-center space-x-2 mt-4">
            <Checkbox
              id="save-signature"
              checked={saveSignature}
              onCheckedChange={(c) => setSaveSignature(!!c)}
            />
            <Label htmlFor="save-signature" className="text-sm font-medium leading-none">
              Save signature for future use
            </Label>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-col items-end pt-4 border-t gap-2">
        {!sessionId && (
          <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-md border border-amber-200">
            Click the document in the chat to open it in the canvas before signing.
          </span>
        )}

        <div className="flex items-center gap-2">
          {!hasSigned ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-10 text-xs px-3 text-primary"
                onClick={() => setIsVisualPlacementOpen(true)}
              >
                Place Visually
              </Button>
              <Button
                onClick={() => handleSubmit()}
                disabled={isSubmitting || !sessionId}
                className="w-full sm:w-auto"
              >
                {isSubmitting ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                Preview Signature
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => handleUndo()}
                disabled={isSubmitting}
                className="w-full sm:w-auto"
              >
                Undo & Adjust
              </Button>
              <Button
                onClick={() => handleConfirm()}
                className="bg-emerald-600 hover:bg-emerald-700 text-white w-full sm:w-auto"
              >
                Confirm Signature
              </Button>
            </>
          )}
        </div>
      </CardFooter>

      <VisualPlacementModal
        open={isVisualPlacementOpen}
        onOpenChange={setIsVisualPlacementOpen}
        fileBase64={base64BeforeSign || fileBase64 || ''}
        totalPages={parsedDocument?.totalPages || 1}
        placements={placements}
        onSave={(newPlacements) => {
          setPlacements(newPlacements);
          handleSubmit(newPlacements);
        }}
        mode={mode}
        imagePayload={
          mode === 'draw' && canvasRef.current
            ? canvasRef.current.toDataURL('image/png')
            : mode === 'upload'
            ? uploadedImage
            : null
        }
        text={text}
        font={font}
        color={color}
        scale={scale}
      />
    </Card>
  );
}
