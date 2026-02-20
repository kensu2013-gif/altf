import { useEffect, useRef } from 'react';
import bgImage from '../../assets/logistics_bg.png';

class Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;

    constructor(width: number, height: number) {
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.vx = (Math.random() - 0.5) * 0.6; // Increased speed by 20%
        this.vy = (Math.random() - 0.5) * 0.6;
        this.size = Math.random() * 2 + 1.5;
    }

    update(width: number, height: number, mouseX: number, mouseY: number) {
        this.x += this.vx;
        this.y += this.vy;

        // Bounce off edges
        if (this.x < 0 || this.x > width) this.vx *= -1;
        if (this.y < 0 || this.y > height) this.vy *= -1;

        // Slight Mouse interaction (Repel or Attract?)
        // "Attract" feels more connected.
        const dx = mouseX - this.x;
        const dy = mouseY - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const mouseRange = 200;

        if (distance < mouseRange) {
            const force = (mouseRange - distance) / mouseRange;
            const angle = Math.atan2(dy, dx);
            // Gentle attraction
            this.x += Math.cos(angle) * force * 0.5;
            this.y += Math.sin(angle) * force * 0.5;
        }
    }

    draw(ctx: CanvasRenderingContext2D) {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = '#60A5FA'; // Blue-400
        ctx.fill();
    }
}

export function InteractiveBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const resizeCanvas = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        const particles: Particle[] = [];
        const particleCount = 80; // Enough to form a network
        const connectionDistance = 150;

        let mouseX = -1000;
        let mouseY = -1000;

        for (let i = 0; i < particleCount; i++) {
            particles.push(new Particle(canvas.width, canvas.height));
        }

        const handleMouseMove = (e: MouseEvent) => {
            mouseX = e.clientX;
            mouseY = e.clientY;
        };
        window.addEventListener('mousemove', handleMouseMove);

        const animate = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Update & Draw Particles and Connections
            for (let i = 0; i < particles.length; i++) {
                const p1 = particles[i];
                p1.update(canvas.width, canvas.height, mouseX, mouseY);
                p1.draw(ctx);

                // Connect to neighbors
                for (let j = i + 1; j < particles.length; j++) {
                    const p2 = particles[j];
                    const dx = p1.x - p2.x;
                    const dy = p1.y - p2.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);

                    if (distance < connectionDistance) {
                        ctx.beginPath();
                        ctx.strokeStyle = `rgba(147, 197, 253, ${1 - distance / connectionDistance})`; // Blue-300 fading
                        ctx.lineWidth = 0.5;
                        ctx.moveTo(p1.x, p1.y);
                        ctx.lineTo(p2.x, p2.y);
                        ctx.stroke();
                    }
                }
            }
            requestAnimationFrame(animate);
        };

        animate();

        return () => {
            window.removeEventListener('resize', resizeCanvas);
            window.removeEventListener('mousemove', handleMouseMove);
        };
    }, []);

    return (
        <div className="fixed inset-0 w-full h-full overflow-hidden -z-10 bg-[#0F172A] pointer-events-none">
            {/* Background Image Layer */}
            <div className="absolute inset-0">
                <img
                    src={bgImage}
                    alt="Logistics Background"
                    className="w-full h-full object-cover opacity-80 animate-in fade-in duration-2000"
                />
            </div>

            {/* Overlays - Lightened for visibility */}
            <div className="absolute inset-0 bg-slate-900/40 mix-blend-multiply" />
            <div className="absolute inset-0 bg-gradient-to-tr from-slate-900/60 via-transparent to-blue-900/20" />

            {/* Canvas Layer */}
            <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full block"
            />
        </div>
    );
}
