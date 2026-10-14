import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Coins, CreditCard, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface CreditTopupModalProps {
  open: boolean;
  onClose: () => void;
  currentCredits: number;
}

// The server owns the real price: ₹500 for 100 credits. `quantity` is the number of packs.
const topupOptions = [
  { id: "small", quantity: 1, credits: 100, price: 50000, popular: false, description: "Perfect for occasional edits" },
  { id: "medium", quantity: 2, credits: 200, price: 100000, popular: true, description: "Great value for regular updates" },
  { id: "large", quantity: 5, credits: 500, price: 250000, popular: false, description: "Best for extensive profile work" },
];

export function CreditTopupModal({ open, onClose, currentCredits }: CreditTopupModalProps) {
  const { toast } = useToast();
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const topupMutation = useMutation({
    mutationFn: async (quantity: number) => {
      const res = await apiRequest("POST", "/api/subscription/credits/topup", { quantity });
      return res.json() as Promise<{ credits: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/credits"] });
      toast({
        title: "Credits Added Successfully!",
        description: `${data.credits} credits have been added to your account`,
      });
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: "Top-up failed", description: error.message, variant: "destructive" });
    },
    onSettled: () => setSelectedOption(null),
  });

  const isProcessing = topupMutation.isPending;

  const handleTopup = (option: typeof topupOptions[0]) => {
    if (isProcessing) return;
    setSelectedOption(option.id);
    topupMutation.mutate(option.quantity);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen && !isProcessing) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5" />
            Buy More Credits
          </DialogTitle>
          <DialogDescription>
            You currently have {currentCredits} credits remaining. Each profile edit costs 5 credits.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="grid gap-3">
            {topupOptions.map((option) => (
              <Card 
                key={option.id} 
                className={`cursor-pointer transition-all hover:shadow-md ${
                  option.popular ? 'border-blue-500 shadow-sm' : ''
                }`}
                onClick={() => !isProcessing && handleTopup(option)}
              >
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Zap className="h-5 w-5 text-yellow-500" />
                        {option.credits} Credits
                      </CardTitle>
                      <p className="text-sm text-gray-600 mt-1">{option.description}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold">₹{(option.price / 100).toFixed(0)}</div>
                      {option.popular && <Badge variant="secondary">Popular</Badge>}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">
                      ≈ {Math.floor(option.credits / 5)} profile edits
                    </span>
                    <Button
                      size="sm"
                      disabled={isProcessing}
                    >
                      <CreditCard className="h-4 w-4 mr-2" />
                      {isProcessing && selectedOption === option.id ? 'Processing...' : 'Buy Now'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="text-xs text-gray-500 text-center pt-2">
            ₹500 per 100 credits. Credits never expire and can be used for any profile edit
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}