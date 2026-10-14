import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle, ExternalLink, Loader2, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface FileUploadProps {
  accept: string;
  onUpload: (file: File) => void;
  children: React.ReactNode;
  disabled?: boolean;
  uploading?: boolean;
  maxSize?: number; // in bytes
}

export function FileUpload({ accept, onUpload, children, disabled, uploading, maxSize = 5 * 1024 * 1024 }: FileUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const blocked = disabled || uploading;

  const handleClick = () => {
    if (!blocked) {
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > maxSize) {
        toast({
          title: "File too large",
          description: `Please select a file smaller than ${Math.round(maxSize / 1024 / 1024)}MB`,
          variant: "destructive"
        });
        event.target.value = "";
        return;
      }
      onUpload(file);
    }
    // Reset the input value to allow selecting the same file again
    event.target.value = "";
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={handleFileChange}
        style={{ display: "none" }}
      />
      <div onClick={handleClick} style={{ cursor: blocked ? "not-allowed" : "pointer" }}>
        {children}
      </div>
    </>
  );
}

export function PhotoUpload({ onUpload, currentPhoto, disabled, uploading }: {
  onUpload: (file: File) => void;
  currentPhoto?: string | null;
  disabled?: boolean;
  uploading?: boolean;
}) {
  return (
    <FileUpload
      accept="image/jpeg,image/png,image/webp"
      onUpload={onUpload}
      disabled={disabled}
      uploading={uploading}
      maxSize={5 * 1024 * 1024} // 5MB
    >
      <div className="flex items-center space-x-4">
        <div className="h-16 w-16 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden">
          {currentPhoto ? (
            <img 
              src={currentPhoto} 
              alt="Profile" 
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : (
            <Upload className="h-6 w-6 text-gray-400" />
          )}
        </div>
        {!disabled && (
          <Button variant="outline" size="sm" type="button" disabled={uploading}>
            {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
            {uploading ? "Uploading..." : "Change Photo"}
          </Button>
        )}
      </div>
    </FileUpload>
  );
}

export function CVUpload({ onUpload, disabled, uploading, currentCv }: {
  onUpload: (file: File) => void;
  disabled?: boolean;
  uploading?: boolean;
  currentCv?: string | null;
}) {
  return (
    <FileUpload
      accept=".pdf,.doc,.docx"
      onUpload={onUpload}
      disabled={disabled}
      uploading={uploading}
      maxSize={10 * 1024 * 1024} // 10MB
    >
      <div className={`border-2 border-dashed rounded-md p-6 text-center transition-colors ${currentCv && !uploading ? "border-green-300 bg-green-50" : "border-gray-300 hover:border-gray-400"}`}>
        {uploading ? (
          <>
            <Loader2 className="mx-auto h-8 w-8 text-primary animate-spin mb-2" />
            <p className="text-sm text-gray-600">Uploading your CV...</p>
          </>
        ) : currentCv ? (
          <>
            <CheckCircle className="mx-auto h-8 w-8 text-green-600 mb-2" />
            <p className="text-sm font-medium text-green-800">CV uploaded ✓</p>
            <a
              href={currentCv}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-1"
            >
              <ExternalLink className="h-3 w-3" /> View CV
            </a>
            {!disabled && <p className="text-xs text-gray-500 mt-1">Click here to replace it (PDF, DOC, DOCX)</p>}
          </>
        ) : (
          <>
            <Upload className="mx-auto h-8 w-8 text-gray-400 mb-2" />
            <p className="text-sm text-gray-600">
              {disabled ? "Upload unavailable right now" : "Click to upload your CV (PDF, DOC, DOCX)"}
            </p>
          </>
        )}
      </div>
    </FileUpload>
  );
}