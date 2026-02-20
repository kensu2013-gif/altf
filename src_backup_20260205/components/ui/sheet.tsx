import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

const SheetContext = React.createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(null);

export const Sheet = ({ children }: { children: React.ReactNode }) => {
    const [open, setOpen] = React.useState(false);
    return <SheetContext.Provider value={{ open, setOpen }}>{children}</SheetContext.Provider>
}

export const SheetTrigger = ({ asChild, children }: { asChild?: boolean; children: React.ReactNode }) => {
    const context = React.useContext(SheetContext);
    if (!context) throw new Error("SheetTrigger must be used within Sheet");

    const child = asChild ? React.Children.only(children) as React.ReactElement : null;

    if (asChild && React.isValidElement(child)) {
        return React.cloneElement(child, {
            onClick: (e: React.MouseEvent) => {
                (child.props as { onClick?: React.MouseEventHandler }).onClick?.(e);
                context.setOpen(true);
            }
        } as React.HTMLAttributes<HTMLElement>);
    }

    return (
        <button onClick={() => context.setOpen(true)}>
            {children}
        </button>
    )
}

export const SheetContent = ({ children, className }: { children: React.ReactNode; className?: string }) => {
    const context = React.useContext(SheetContext);
    if (!context) throw new Error("SheetContent must be used within Sheet");

    if (!context.open) return null;

    return (
        <>
            <div
                className="fixed inset-0 z-50 bg-black/80"
                onClick={() => context.setOpen(false)}
            />
            <div className={cn("fixed inset-y-0 right-0 z-50 h-full w-3/4 gap-4 border-l bg-white p-6 shadow-lg transition ease-in-out sm:max-w-sm", className)}>
                <button
                    className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary"
                    onClick={() => context.setOpen(false)}
                >
                    <X className="h-4 w-4" />
                    <span className="sr-only">Close</span>
                </button>
                {children}
            </div>
        </>
    )
}
