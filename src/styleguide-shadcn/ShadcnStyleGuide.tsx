import {
  AlertCircle,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Copy,
  Edit,
  Info,
  Loader2,
  MoreHorizontal,
  Plus,
  Send,
  Settings,
  Sparkles,
  Trash2,
  User,
} from 'lucide-react';

import { useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from './components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from './components/ui/avatar';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/ui/card';
import { Checkbox } from './components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './components/ui/dialog';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Progress } from './components/ui/progress';
import { RadioGroup, RadioGroupItem } from './components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';
import { Separator } from './components/ui/separator';
import { Switch } from './components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Textarea } from './components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/ui/tooltip';

// Sample data for table
const sampleData = [
  { id: '1', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', status: 'active', tokens: '200K' },
  { id: '2', name: 'GPT-4 Turbo', provider: 'OpenAI', status: 'active', tokens: '128K' },
  { id: '3', name: 'Llama 3.1 70B', provider: 'Meta', status: 'pending', tokens: '128K' },
  { id: '4', name: 'Mistral Large', provider: 'Mistral', status: 'inactive', tokens: '32K' },
];

// Section component for consistent styling
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export default function ShadcnStyleGuide() {
  const [inputValue, setInputValue] = useState('');
  const [selectValue, setSelectValue] = useState('');
  const [radioValue, setRadioValue] = useState('option1');
  const [checkboxChecked, setCheckboxChecked] = useState(false);
  const [switchChecked, setSwitchChecked] = useState(false);
  const [progress, setProgress] = useState(45);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        {/* Header */}
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-14 max-w-screen-2xl items-center px-8">
            <div className="flex items-center space-x-2">
              <Sparkles className="h-6 w-6 text-primary" />
              <span className="font-bold text-lg">Shadcn UI Style Guide</span>
            </div>
            <div className="flex flex-1 items-center justify-end space-x-2">
              <Badge variant="secondary">v1.0</Badge>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="container max-w-screen-2xl px-8 py-8">
          <div className="space-y-12">
            {/* Introduction */}
            <div className="space-y-2">
              <h1 className="text-3xl font-bold tracking-tight">Component Reference</h1>
              <p className="text-muted-foreground max-w-3xl">
                A comprehensive style guide showcasing Shadcn UI components. Built with Radix UI
                primitives and styled with Tailwind CSS.
              </p>
            </div>

            <Separator />

            {/* Tabs for organization */}
            <Tabs defaultValue="buttons" className="space-y-6">
              <TabsList className="grid w-full grid-cols-6 lg:w-auto lg:inline-grid">
                <TabsTrigger value="buttons">Buttons</TabsTrigger>
                <TabsTrigger value="forms">Forms</TabsTrigger>
                <TabsTrigger value="data">Data Display</TabsTrigger>
                <TabsTrigger value="feedback">Feedback</TabsTrigger>
                <TabsTrigger value="genai">GenAI</TabsTrigger>
                <TabsTrigger value="overlays">Overlays</TabsTrigger>
              </TabsList>

              {/* Buttons Tab */}
              <TabsContent value="buttons" className="space-y-8">
                <Section
                  title="Button Variants"
                  description="Different button styles for various use cases"
                >
                  <Card>
                    <CardContent className="pt-6">
                      <div className="space-y-6">
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                            Primary Actions
                          </Label>
                          <div className="flex flex-wrap gap-3">
                            <Button>Default</Button>
                            <Button variant="secondary">Secondary</Button>
                            <Button variant="destructive">Destructive</Button>
                            <Button variant="outline">Outline</Button>
                            <Button variant="ghost">Ghost</Button>
                            <Button variant="link">Link</Button>
                          </div>
                        </div>

                        <Separator />

                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                            Button Sizes
                          </Label>
                          <div className="flex flex-wrap items-center gap-3">
                            <Button size="sm">Small</Button>
                            <Button size="default">Default</Button>
                            <Button size="lg">Large</Button>
                            <Button size="icon">
                              <Settings className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>

                        <Separator />

                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                            With Icons
                          </Label>
                          <div className="flex flex-wrap gap-3">
                            <Button>
                              <Plus className="mr-2 h-4 w-4" /> Add New
                            </Button>
                            <Button variant="outline">
                              <Edit className="mr-2 h-4 w-4" /> Edit
                            </Button>
                            <Button variant="destructive">
                              <Trash2 className="mr-2 h-4 w-4" /> Delete
                            </Button>
                            <Button variant="secondary">
                              <Copy className="mr-2 h-4 w-4" /> Copy
                            </Button>
                          </div>
                        </div>

                        <Separator />

                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                            States
                          </Label>
                          <div className="flex flex-wrap gap-3">
                            <Button disabled>Disabled</Button>
                            <Button disabled>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Section>
              </TabsContent>

              {/* Forms Tab */}
              <TabsContent value="forms" className="space-y-8">
                <div className="grid gap-8 lg:grid-cols-2">
                  <Section title="Input Fields" description="Text inputs and textareas">
                    <Card>
                      <CardContent className="pt-6 space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="default-input">Default Input</Label>
                          <Input
                            id="default-input"
                            placeholder="Enter text..."
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="disabled-input">Disabled Input</Label>
                          <Input id="disabled-input" placeholder="Disabled" disabled />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="textarea">Textarea</Label>
                          <Textarea id="textarea" placeholder="Enter your message..." rows={3} />
                        </div>
                      </CardContent>
                    </Card>
                  </Section>

                  <Section title="Select" description="Dropdown selection components">
                    <Card>
                      <CardContent className="pt-6 space-y-4">
                        <div className="space-y-2">
                          <Label>Model Selection</Label>
                          <Select value={selectValue} onValueChange={setSelectValue}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a model" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                <SelectLabel>Anthropic</SelectLabel>
                                <SelectItem value="claude-3.5-sonnet">Claude 3.5 Sonnet</SelectItem>
                                <SelectItem value="claude-3-opus">Claude 3 Opus</SelectItem>
                              </SelectGroup>
                              <SelectGroup>
                                <SelectLabel>OpenAI</SelectLabel>
                                <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                                <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                              </SelectGroup>
                              <SelectGroup>
                                <SelectLabel>Local</SelectLabel>
                                <SelectItem value="llama-3.1">Llama 3.1 70B</SelectItem>
                                <SelectItem value="mistral">Mistral Large</SelectItem>
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Disabled Select</Label>
                          <Select disabled>
                            <SelectTrigger>
                              <SelectValue placeholder="Disabled" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">Option 1</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </CardContent>
                    </Card>
                  </Section>
                </div>

                <div className="grid gap-8 lg:grid-cols-2">
                  <Section title="Radio Group" description="Single selection from multiple options">
                    <Card>
                      <CardContent className="pt-6">
                        <RadioGroup value={radioValue} onValueChange={setRadioValue}>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="option1" id="option1" />
                            <Label htmlFor="option1">Default Option</Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="option2" id="option2" />
                            <Label htmlFor="option2">Alternative Option</Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="option3" id="option3" />
                            <Label htmlFor="option3">Another Option</Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="disabled" id="disabled" disabled />
                            <Label htmlFor="disabled" className="text-muted-foreground">
                              Disabled Option
                            </Label>
                          </div>
                        </RadioGroup>
                      </CardContent>
                    </Card>
                  </Section>

                  <Section title="Checkbox & Switch" description="Toggle controls">
                    <Card>
                      <CardContent className="pt-6 space-y-6">
                        <div className="space-y-4">
                          <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                            Checkboxes
                          </Label>
                          <div className="space-y-3">
                            <div className="flex items-center space-x-2">
                              <Checkbox
                                id="terms"
                                checked={checkboxChecked}
                                onCheckedChange={(checked) =>
                                  setCheckboxChecked(checked as boolean)
                                }
                              />
                              <Label htmlFor="terms">Accept terms and conditions</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                              <Checkbox id="disabled-check" disabled />
                              <Label htmlFor="disabled-check" className="text-muted-foreground">
                                Disabled checkbox
                              </Label>
                            </div>
                          </div>
                        </div>
                        <Separator />
                        <div className="space-y-4">
                          <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                            Switches
                          </Label>
                          <div className="space-y-3">
                            <div className="flex items-center space-x-2">
                              <Switch
                                id="airplane-mode"
                                checked={switchChecked}
                                onCheckedChange={setSwitchChecked}
                              />
                              <Label htmlFor="airplane-mode">Enable notifications</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                              <Switch id="disabled-switch" disabled />
                              <Label htmlFor="disabled-switch" className="text-muted-foreground">
                                Disabled switch
                              </Label>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Section>
                </div>
              </TabsContent>

              {/* Data Display Tab */}
              <TabsContent value="data" className="space-y-8">
                <Section title="Table" description="Display tabular data">
                  <Card>
                    <CardHeader>
                      <CardTitle>Available Models</CardTitle>
                      <CardDescription>A list of AI models available for use</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[100px]">ID</TableHead>
                            <TableHead>Model Name</TableHead>
                            <TableHead>Provider</TableHead>
                            <TableHead>Context</TableHead>
                            <TableHead className="text-right">Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sampleData.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell className="font-medium">{item.id}</TableCell>
                              <TableCell>{item.name}</TableCell>
                              <TableCell>{item.provider}</TableCell>
                              <TableCell>{item.tokens}</TableCell>
                              <TableCell className="text-right">
                                <Badge
                                  variant={
                                    item.status === 'active'
                                      ? 'default'
                                      : item.status === 'pending'
                                        ? 'secondary'
                                        : 'outline'
                                  }
                                >
                                  {item.status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </Section>

                <div className="grid gap-8 lg:grid-cols-2">
                  <Section title="Cards" description="Container components">
                    <Card>
                      <CardHeader>
                        <CardTitle>Card Title</CardTitle>
                        <CardDescription>Card description goes here</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground">
                          This is the card content area. You can put any content here.
                        </p>
                      </CardContent>
                      <CardFooter className="flex justify-between">
                        <Button variant="outline">Cancel</Button>
                        <Button>Save</Button>
                      </CardFooter>
                    </Card>
                  </Section>

                  <Section title="Badges" description="Status indicators and labels">
                    <Card>
                      <CardContent className="pt-6 space-y-4">
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                            Variants
                          </Label>
                          <div className="flex flex-wrap gap-2">
                            <Badge>Default</Badge>
                            <Badge variant="secondary">Secondary</Badge>
                            <Badge variant="destructive">Destructive</Badge>
                            <Badge variant="outline">Outline</Badge>
                          </div>
                        </div>
                        <Separator />
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                            Use Cases
                          </Label>
                          <div className="flex flex-wrap gap-2">
                            <Badge className="bg-green-500 hover:bg-green-600">Active</Badge>
                            <Badge className="bg-yellow-500 hover:bg-yellow-600">Pending</Badge>
                            <Badge className="bg-blue-500 hover:bg-blue-600">New</Badge>
                            <Badge variant="outline" className="border-purple-500 text-purple-600">
                              Beta
                            </Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Section>
                </div>

                <div className="grid gap-8 lg:grid-cols-2">
                  <Section title="Avatar" description="User profile images">
                    <Card>
                      <CardContent className="pt-6">
                        <div className="flex items-center gap-4">
                          <Avatar>
                            <AvatarImage src="https://github.com/shadcn.png" alt="User" />
                            <AvatarFallback>CN</AvatarFallback>
                          </Avatar>
                          <Avatar>
                            <AvatarFallback>JD</AvatarFallback>
                          </Avatar>
                          <Avatar>
                            <AvatarFallback className="bg-primary text-primary-foreground">
                              AI
                            </AvatarFallback>
                          </Avatar>
                          <Avatar className="h-12 w-12">
                            <AvatarFallback className="bg-gradient-to-br from-purple-500 to-pink-500 text-white">
                              LG
                            </AvatarFallback>
                          </Avatar>
                        </div>
                      </CardContent>
                    </Card>
                  </Section>

                  <Section title="Progress" description="Progress indicators">
                    <Card>
                      <CardContent className="pt-6 space-y-4">
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span>Progress</span>
                            <span>{progress}%</span>
                          </div>
                          <Progress value={progress} />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setProgress(Math.max(0, progress - 10))}
                          >
                            -10
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setProgress(Math.min(100, progress + 10))}
                          >
                            +10
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </Section>
                </div>
              </TabsContent>

              {/* Feedback Tab */}
              <TabsContent value="feedback" className="space-y-8">
                <Section title="Alerts" description="Contextual feedback messages">
                  <div className="space-y-4">
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertTitle>Information</AlertTitle>
                      <AlertDescription>This is an informational alert message.</AlertDescription>
                    </Alert>
                    <Alert variant="success">
                      <CheckCircle2 className="h-4 w-4" />
                      <AlertTitle>Success</AlertTitle>
                      <AlertDescription>
                        Your changes have been saved successfully.
                      </AlertDescription>
                    </Alert>
                    <Alert variant="warning">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Warning</AlertTitle>
                      <AlertDescription>
                        This action may have unintended consequences.
                      </AlertDescription>
                    </Alert>
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Error</AlertTitle>
                      <AlertDescription>Something went wrong. Please try again.</AlertDescription>
                    </Alert>
                  </div>
                </Section>

                <Section title="Tooltips" description="Contextual information on hover">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex gap-4">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="outline">Hover me</Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>This is a tooltip</p>
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="icon" variant="ghost">
                              <Info className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>More information</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </CardContent>
                  </Card>
                </Section>
              </TabsContent>

              {/* GenAI Tab */}
              <TabsContent value="genai" className="space-y-8">
                <Section
                  title="Chat Interface Components"
                  description="Components for AI chat interfaces"
                >
                  <Card>
                    <CardContent className="pt-6 space-y-6">
                      {/* Chat Messages */}
                      <div className="space-y-4">
                        <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                          Chat Messages
                        </Label>

                        {/* User Message */}
                        <div className="flex gap-3 justify-end">
                          <div className="max-w-[80%] rounded-lg bg-primary text-primary-foreground px-4 py-2">
                            <p className="text-sm">How can I optimize my React application?</p>
                          </div>
                          <Avatar className="h-8 w-8">
                            <AvatarFallback>
                              <User className="h-4 w-4" />
                            </AvatarFallback>
                          </Avatar>
                        </div>

                        {/* AI Message */}
                        <div className="flex gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                              <Bot className="h-4 w-4" />
                            </AvatarFallback>
                          </Avatar>
                          <div className="max-w-[80%] space-y-2">
                            <div className="rounded-lg bg-muted px-4 py-2">
                              <p className="text-sm">
                                Here are some ways to optimize your React application:
                              </p>
                              <ul className="text-sm mt-2 space-y-1 list-disc list-inside text-muted-foreground">
                                <li>Use React.memo for expensive components</li>
                                <li>Implement code splitting with lazy loading</li>
                                <li>Optimize re-renders with useMemo and useCallback</li>
                              </ul>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                <Sparkles className="h-3 w-3 mr-1" />
                                AI Generated
                              </Badge>
                            </div>
                          </div>
                        </div>
                      </div>

                      <Separator />

                      {/* Chat Input */}
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                          Chat Input
                        </Label>
                        <div className="flex gap-2">
                          <Textarea
                            placeholder="Send a message..."
                            className="min-h-[60px] resize-none"
                          />
                          <Button size="icon" className="h-[60px] w-[60px]">
                            <Send className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Section>

                <div className="grid gap-8 lg:grid-cols-2">
                  <Section title="AI Action Buttons" description="Buttons for AI-related actions">
                    <Card>
                      <CardContent className="pt-6 space-y-4">
                        <div className="flex flex-wrap gap-3">
                          <Button className="bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700">
                            <Sparkles className="mr-2 h-4 w-4" />
                            Generate
                          </Button>
                          <Button variant="outline">
                            <Sparkles className="mr-2 h-4 w-4 text-purple-500" />
                            Optimize Prompt
                          </Button>
                          <Button variant="secondary">
                            <Bot className="mr-2 h-4 w-4" />
                            Ask AI
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </Section>

                  <Section title="Model Selection Card" description="Card for selecting AI models">
                    <Card>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base">Model</CardTitle>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <Select defaultValue="claude-3.5-sonnet">
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="claude-3.5-sonnet">
                              <div className="flex items-center gap-2">
                                <div className="h-2 w-2 rounded-full bg-green-500" />
                                Claude 3.5 Sonnet
                              </div>
                            </SelectItem>
                            <SelectItem value="gpt-4-turbo">
                              <div className="flex items-center gap-2">
                                <div className="h-2 w-2 rounded-full bg-green-500" />
                                GPT-4 Turbo
                              </div>
                            </SelectItem>
                            <SelectItem value="llama-3.1">
                              <div className="flex items-center gap-2">
                                <div className="h-2 w-2 rounded-full bg-yellow-500" />
                                Llama 3.1 70B
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-2">200K context window</p>
                      </CardContent>
                    </Card>
                  </Section>
                </div>

                <Section title="Loading States" description="AI processing indicators">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                            <Bot className="h-4 w-4" />
                          </AvatarFallback>
                        </Avatar>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Generating response...</span>
                          </div>
                          <div className="flex gap-1">
                            <div className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                            <div className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                            <div className="h-2 w-2 rounded-full bg-primary animate-bounce" />
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Section>
              </TabsContent>

              {/* Overlays Tab */}
              <TabsContent value="overlays" className="space-y-8">
                <Section title="Dialog" description="Modal dialogs for focused interactions">
                  <Card>
                    <CardContent className="pt-6">
                      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                        <DialogTrigger asChild>
                          <Button>Open Dialog</Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Edit Profile</DialogTitle>
                            <DialogDescription>
                              Make changes to your profile here. Click save when you are done.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                              <Label htmlFor="name" className="text-right">
                                Name
                              </Label>
                              <Input id="name" defaultValue="John Doe" className="col-span-3" />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                              <Label htmlFor="username" className="text-right">
                                Username
                              </Label>
                              <Input id="username" defaultValue="@johndoe" className="col-span-3" />
                            </div>
                          </div>
                          <DialogFooter>
                            <Button variant="outline" onClick={() => setDialogOpen(false)}>
                              Cancel
                            </Button>
                            <Button onClick={() => setDialogOpen(false)}>Save changes</Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </CardContent>
                  </Card>
                </Section>
              </TabsContent>
            </Tabs>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t py-6 md:py-0">
          <div className="container flex flex-col items-center justify-between gap-4 md:h-16 md:flex-row px-8">
            <p className="text-sm text-muted-foreground">
              Built with Shadcn UI, Radix UI, and Tailwind CSS
            </p>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}
