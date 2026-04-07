import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { User } from '../../types';

export function ManagerMultiSelect({ 
    currentManagers, 
    users, 
    onUpdate 
}: { 
    currentManagers: { id: string, name: string }[], 
    users: User[], 
    onUpdate: (managers: { id: string, name: string }[]) => void 
}) {
    const [isOpen, setIsOpen] = useState(false);

    const toggleManager = (user: User) => {
        const isSelected = currentManagers.some(m => m.id === user.id);
        let newManagers;
        if (isSelected) {
            newManagers = currentManagers.filter(m => m.id !== user.id);
        } else {
            newManagers = [...currentManagers, { id: user.id, name: user.contactName || (user as User & { name?: string }).name || user.email }];
        }
        onUpdate(newManagers);
    };

    return (
        <div className="relative mt-2 min-w-[200px]">
            <button 
                onClick={() => setIsOpen(!isOpen)}
                className="flex flex-wrap gap-1 items-center bg-slate-50 border border-slate-200 rounded px-2 py-1 min-h-[28px] w-full text-left"
            >
                {currentManagers.length === 0 ? (
                    <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">담당자 지정 (다중선택)</span>
                ) : (
                    currentManagers.map(m => (
                        <span key={m.id} className="text-[10px] bg-indigo-50 border border-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded flex items-center gap-1 font-bold">
                            {m.name}
                        </span>
                    ))
                )}
                <ChevronDown className="w-3 h-3 text-slate-400 ml-auto flex-shrink-0" />
            </button>
            
            {isOpen && (
                <>
                    <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
                    <div className="absolute left-0 mt-1 w-full min-w-[200px] bg-white border border-slate-200 rounded shadow-lg z-50 py-1 max-h-48 overflow-y-auto">
                        {users.map((u: User) => {
                            const name = u.contactName || (u as User & { name?: string }).name || u.email;
                            const isSelected = currentManagers.some(m => m.id === u.id);
                            return (
                                <button
                                    key={u.id}
                                    onClick={() => toggleManager(u)}
                                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center gap-2"
                                >
                                    <div className={`w-3 h-3 rounded flex items-center justify-center border flex-shrink-0 ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`}>
                                        {isSelected && <svg className="w-2 h-2 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"></polyline></svg>}
                                    </div>
                                    <span className={isSelected ? 'font-bold text-slate-800' : 'text-slate-600'}>{name}</span>
                                </button>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}
