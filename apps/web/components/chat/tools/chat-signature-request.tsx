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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, PenTool, Type, Upload, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { get, set } from 'idb-keyval';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';

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
}: {
  detectedLocations?: DetectedLocation[];
}) {
  const { sessionId, parsedDocument, updateFromToolResult } = useDocEditor();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State
  const [mode, setMode] = useState<'type' | 'draw' | 'upload'>('type');
  const [pageIndex, setPageIndex] = useState(
    detectedLocations && detectedLocations.length > 0
      ? detectedLocations[0].pageIndex.toString()
      : '0',
  );

  // Saved Signatures State
  const [savedSignatures, setSavedSignatures] = useState<SavedSignature[]>([]);
  const [saveSignature, setSaveSignature] = useState(false);

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

  // Extra Fields
  const [date, setDate] = useState('');
  const [extraText, setExtraText] = useState('');

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
    const x = clientX - rect.left;
    const y = clientY - rect.top;

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

  const handleSubmit = async () => {
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

      // Adjust dimensions/scale if necessary in the backend payload.
      // We pass the scale to let the backend size it.
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
            pageIndex: parseInt(pageIndex, 10),
            x: 50,
            y: 50, // Default coordinates for now
            scale: scale / 100, // Pass scale as a multiplier
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to sign document');
      }

      const resData = await res.json();

      toast.success('Signature applied successfully');
      updateFromToolResult({
        sessionId,
        fields: resData.document.parsed.fields,
        updatedFields: [],
        fileBase64: resData.document.fileBase64,
        pages: resData.document.parsed.pages,
        totalPages: resData.document.parsed.totalPages,
      });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full max-w-md my-4">
      <CardHeader>
        <CardTitle className="text-lg">Signature Request</CardTitle>
        <CardDescription>Sign the document to continue.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {detectedLocations && detectedLocations.length > 0 && (
          <div className="bg-muted p-3 rounded-md text-sm mb-4">
            <span className="font-semibold block mb-1">Detected Placement:</span>
            {detectedLocations.map((loc, i) => (
              <div key={i} className="text-muted-foreground flex justify-between">
                <span>Page {loc.pageIndex + 1}</span>
                <span className="italic truncate ml-2 max-w-[200px]">{loc.context}</span>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs">Page Number</Label>
          <Select value={pageIndex} onValueChange={(val) => val && setPageIndex(val)}>
            <SelectTrigger>
              <SelectValue placeholder="Select page" />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: parsedDocument?.totalPages || 1 }).map((_, i) => (
                <SelectItem key={i} value={i.toString()}>
                  Page {i + 1}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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

        <Tabs value={mode} onValueChange={(v) => setMode(v as 'type' | 'draw' | 'upload')}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="type">
              <Type className="size-4 mr-2" /> Type
            </TabsTrigger>
            <TabsTrigger value="draw">
              <PenTool className="size-4 mr-2" /> Draw
            </TabsTrigger>
            <TabsTrigger value="upload">
              <Upload className="size-4 mr-2" /> Upload
            </TabsTrigger>
          </TabsList>

          <TabsContent value="type" className="space-y-4 mt-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Your Name</Label>
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="John Doe"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Font Style</Label>
              <Select value={font} onValueChange={(val) => val && setFont(val)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select font" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Helvetica">Standard</SelectItem>
                  <SelectItem value="Cursive">Cursive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          <TabsContent value="draw" className="space-y-4 mt-4">
            <div className="border rounded-md bg-white overflow-hidden touch-none relative">
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
          </TabsContent>

          <TabsContent value="upload" className="space-y-4 mt-4">
            <div className="border-2 border-dashed rounded-md p-6 flex flex-col items-center justify-center text-center relative overflow-hidden">
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
          </TabsContent>
        </Tabs>

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

        <div className="grid grid-cols-2 gap-4 mt-4">
          <div className="space-y-2">
            <Label className="text-xs block mb-1">Signature Color</Label>
            <div className="flex gap-2">
              {['black', 'blue', 'red'].map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`size-6 rounded-full border ${
                    color === c ? 'ring-2 ring-primary ring-offset-1' : ''
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>
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
        </div>

        <div className="grid grid-cols-2 gap-4 mt-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Date (Optional)</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Extra Text (Optional)</Label>
            <Input
              value={extraText}
              onChange={(e) => setExtraText(e.target.value)}
              placeholder="Title, Company, etc."
            />
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-end pt-4 border-t">
        <Button
          onClick={handleSubmit}
          disabled={isSubmitting || !sessionId}
          className="w-full sm:w-auto"
        >
          {isSubmitting ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          Sign Document
        </Button>
      </CardFooter>
    </Card>
  );
}
