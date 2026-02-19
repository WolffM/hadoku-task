import { useState, useEffect } from "react";

/*
 * GRADIENT WINDOW EFFECT
 * ======================
 * 
 * Features:
 * - Cards as windows into shared gradient
 * - Color-aware glow on hover
 * - 10 shimmer animation experiments
 */

// ============================================
// GRADIENT PRESETS - Final 3
// ============================================
const gradientPresets = [
  {
    name: "Beach Day",
    gradient: `linear-gradient(
      135deg,
      oklch(0.82 0.18 55) 0%,
      oklch(0.78 0.2 40) 15%,
      oklch(0.72 0.22 25) 30%,
      oklch(0.7 0.18 10) 45%,
      oklch(0.72 0.16 355) 55%,
      oklch(0.68 0.14 190) 70%,
      oklch(0.6 0.16 200) 85%,
      oklch(0.5 0.18 210) 100%
    )`,
  },
  {
    name: "Cotton Candy",
    gradient: `linear-gradient(
      135deg,
      oklch(0.88 0.14 330) 0%,
      oklch(0.82 0.16 350) 25%,
      oklch(0.8 0.12 30) 50%,
      oklch(0.85 0.1 60) 75%,
      oklch(0.9 0.08 90) 100%
    )`,
  },
  {
    name: "Aurora",
    gradient: `linear-gradient(
      135deg,
      oklch(0.75 0.2 160) 0%,
      oklch(0.65 0.22 180) 25%,
      oklch(0.6 0.2 220) 50%,
      oklch(0.55 0.18 280) 75%,
      oklch(0.6 0.16 320) 100%
    )`,
  },
];

// ============================================
// WINDOW CARD WITH GLOW (no shimmer)
// ============================================
function WindowCard({ children, className = "" }) {
  const [isHovered, setIsHovered] = useState(false);
  
  return (
    <div
      className={`window-card-wrapper ${isHovered ? 'is-hovered' : ''} ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="window-card">
        <div className="relative z-10 h-full">
          {children}
        </div>
      </div>
    </div>
  );
}

// ============================================
// SAMPLE CARDS
// ============================================
const sampleCards = [
  { title: "Profile", span: "col-span-1 row-span-1", content: "👤" },
  { title: "Projects", span: "col-span-2 row-span-1", content: "📁" },
  { title: "Links", span: "col-span-1 row-span-2", content: "🔗" },
  { title: "Tech Stack", span: "col-span-1 row-span-1", content: "⚡" },
  { title: "Blog", span: "col-span-1 row-span-1", content: "✍️" },
  { title: "Contact", span: "col-span-2 row-span-1", content: "💬" },
  { title: "Gallery", span: "col-span-1 row-span-1", content: "🖼️" },
  { title: "Stats", span: "col-span-1 row-span-1", content: "📊" },
];

// ============================================
// SHIMMER EFFECTS - Final 3
// ============================================
const shimmerExperiments = [
  {
    name: "Cascade Rich",
    description: "Multi-wave, varied speeds",
    className: "shimmer-cascade-rich",
    usesMouse: false,
  },
  {
    name: "Sat + Rich",
    description: "Saturation + cascade",
    className: "shimmer-sat-rich",
    usesMouse: false,
  },
  {
    name: "Shift",
    description: "Gradient displacement",
    className: "shimmer-shift",
    usesMouse: false,
  },
];

// (MouseShimmerBox removed - no mouse-based effects in final 3)

// ============================================
// MAIN COMPONENT
// ============================================
export default function GradientWindowDemo() {
  const [selectedGradient, setSelectedGradient] = useState(gradientPresets[0]);
  const [mouseOffset, setMouseOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 30;
      const y = (e.clientY / window.innerHeight - 0.5) * 30;
      setMouseOffset({ x, y });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <>
      <style>{`
        /* Base card styles */
        .window-card {
          background: ${selectedGradient.gradient};
          background-attachment: fixed;
          background-position: calc(50% + ${mouseOffset.x}px) calc(50% + ${mouseOffset.y}px);
          border-radius: 1rem;
          position: relative;
          overflow: hidden;
          height: 100%;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08), 
                      inset 0 0 0 1px rgba(255,255,255,0.1);
          transition: box-shadow 0.3s ease;
        }
        
        .window-card-wrapper {
          position: relative;
          cursor: pointer;
        }
        
        /* Color-aware glow behind card */
        .window-card-wrapper::before {
          content: '';
          position: absolute;
          inset: 0;
          background: ${selectedGradient.gradient};
          background-attachment: fixed;
          background-position: calc(50% + ${mouseOffset.x}px) calc(50% + ${mouseOffset.y}px);
          border-radius: 1rem;
          filter: blur(20px);
          opacity: 0;
          transform: scale(0.95);
          transition: opacity 0.4s ease, transform 0.4s ease;
          z-index: -1;
        }
        
        .window-card-wrapper.is-hovered::before {
          opacity: 0.6;
          transform: scale(1.02);
        }
        
        .window-card-wrapper.is-hovered .window-card {
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15), 
                      inset 0 0 0 1px rgba(255,255,255,0.2);
        }

        /* Button styles */
        .window-button-wrapper {
          position: relative;
          display: inline-block;
        }
        
        .window-button-wrapper::before {
          content: '';
          position: absolute;
          inset: 0;
          background: ${selectedGradient.gradient};
          background-attachment: fixed;
          background-position: calc(50% + ${mouseOffset.x}px) calc(50% + ${mouseOffset.y}px);
          border-radius: 0.75rem;
          filter: blur(12px);
          opacity: 0;
          transform: scale(0.9);
          transition: opacity 0.3s ease, transform 0.3s ease;
          z-index: -1;
        }
        
        .window-button-wrapper:hover::before {
          opacity: 0.7;
          transform: scale(1.1);
        }
        
        .window-button {
          background: ${selectedGradient.gradient};
          background-attachment: fixed;
          background-position: calc(50% + ${mouseOffset.x}px) calc(50% + ${mouseOffset.y}px);
          position: relative;
          overflow: hidden;
        }

        /* ========================================
           SHIMMER - FINAL 3 EFFECTS
           ======================================== */
        
        .shimmer-box {
          background: ${selectedGradient.gradient};
          background-attachment: fixed;
          background-position: calc(50% + ${mouseOffset.x}px) calc(50% + ${mouseOffset.y}px);
          border-radius: 0.75rem;
          position: relative;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1), inset 0 0 0 1px rgba(255,255,255,0.1);
        }

        /* 1. CASCADE RICH - Multi-wave with max variation */
        .shimmer-cascade-rich::before {
          content: '';
          position: absolute;
          inset: -80%;
          background: linear-gradient(
            135deg,
            transparent 38%,
            rgba(255,255,255,0.03) 44%,
            rgba(255,255,255,0.03) 48%,
            transparent 54%
          );
          transform: translateX(-50%) translateY(-50%);
          opacity: 0;
          transition: transform 1.2s ease-out, opacity 0.2s ease;
          pointer-events: none;
        }
        .shimmer-cascade-rich::after {
          content: '';
          position: absolute;
          inset: -150%;
          background: linear-gradient(
            135deg,
            transparent 0%,
            transparent 22%,
            rgba(255,255,255,0.05) 26%,
            transparent 30%,
            transparent 40%,
            rgba(255,255,255,0.12) 45%,
            rgba(255,255,255,0.18) 48%,
            rgba(255,255,255,0.12) 51%,
            transparent 56%,
            transparent 66%,
            rgba(255,255,255,0.06) 70%,
            transparent 74%,
            transparent 100%
          );
          transform: translateX(-45%) translateY(-45%);
          opacity: 0;
          transition: transform 4s cubic-bezier(0.22, 0.61, 0.36, 1) 0.1s, opacity 0.5s ease 0.1s;
        }
        .shimmer-cascade-rich:hover::before {
          transform: translateX(50%) translateY(50%);
          opacity: 1;
        }
        .shimmer-cascade-rich:hover::after {
          transform: translateX(45%) translateY(45%);
          opacity: 1;
        }

        /* 2. SAT + RICH - Saturation boost with 4-band cascade */
        .shimmer-sat-rich {
          filter: saturate(1) brightness(1);
          transition: filter 0.6s ease-out, box-shadow 0.6s ease-out;
        }
        .shimmer-sat-rich::after {
          content: '';
          position: absolute;
          inset: -100%;
          background: linear-gradient(
            135deg,
            transparent 20%,
            rgba(255,255,255,0.03) 30%,
            transparent 38%,
            transparent 44%,
            rgba(255,255,255,0.1) 50%,
            rgba(255,255,255,0.16) 52%,
            rgba(255,255,255,0.1) 54%,
            transparent 60%,
            transparent 70%,
            rgba(255,255,255,0.04) 78%,
            transparent 86%
          );
          transform: translateX(-50%) translateY(-50%);
          opacity: 0;
          transition: transform 3s ease-out, opacity 0.6s ease-out;
        }
        .shimmer-sat-rich:hover {
          filter: saturate(1.15) brightness(1.05);
          box-shadow: 0 4px 16px rgba(0,0,0,0.1), inset 0 0 0 1px rgba(255,255,255,0.18);
        }
        .shimmer-sat-rich:hover::after {
          transform: translateX(50%) translateY(50%);
          opacity: 1;
        }

        /* 3. SHIFT - Gradient displacement on hover */
        .shimmer-shift::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: ${selectedGradient.gradient};
          background-size: 130% 130%;
          background-position: 30% 30%;
          opacity: 0;
          transition: opacity 0.4s ease, background-position 0.8s ease-out;
        }
        .shimmer-shift:hover::after {
          opacity: 1;
          background-position: 70% 70%;
        }
      `}</style>
      
      <div className="min-h-screen bg-white">
        {/* Header */}
        <div className="p-8 pb-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-1">
            Gradient Windows
          </h1>
          <p className="text-gray-500 mb-6">
            Cards as windows into a shared gradient
          </p>

          {/* Gradient Picker */}
          <div className="flex flex-wrap gap-3">
            {gradientPresets.map((preset) => (
              <button
                key={preset.name}
                onClick={() => setSelectedGradient(preset)}
                className={`
                  px-4 py-2 rounded-xl text-sm font-medium
                  transition-all duration-200 hover:brightness-110
                  ${selectedGradient.name === preset.name
                    ? "ring-2 ring-gray-800 ring-offset-2"
                    : "hover:shadow-md"
                  }
                `}
                style={{
                  background: preset.gradient,
                  color: "white",
                  textShadow: "0 1px 2px rgba(0,0,0,0.3)",
                }}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className="px-4 md:px-8 pb-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 auto-rows-[120px]">
            {sampleCards.map((card) => (
              <WindowCard
                key={card.title}
                className={card.span}
              >
                <div className="p-4 h-full flex flex-col justify-between">
                  <span className="text-2xl">{card.content}</span>
                  <span className="text-white font-medium text-sm drop-shadow-sm">
                    {card.title}
                  </span>
                </div>
              </WindowCard>
            ))}
          </div>
        </div>

        {/* Buttons */}
        <div className="px-4 md:px-8 py-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            Buttons with color-aware glow
          </h2>
          <div className="flex flex-wrap gap-3">
            {["Primary", "Success", "Warning", "Danger", "Info"].map((label) => (
              <span key={label} className="window-button-wrapper">
                <button
                  className="window-button px-5 py-2.5 rounded-xl text-white font-medium text-sm"
                  style={{ textShadow: "0 1px 2px rgba(0,0,0,0.2)" }}
                >
                  {label}
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Shimmer Effects - Final 3 */}
        <div className="px-4 md:px-8 py-8 border-t border-gray-100">
          <h2 className="text-xl font-bold text-gray-800 mb-2">
            Shimmer Effects
          </h2>
          <p className="text-gray-500 mb-6">
            Final 3 — hover to preview
          </p>
          
          <div className="grid grid-cols-3 gap-6">
            {shimmerExperiments.map((exp) => (
              <div key={exp.name} className="text-center">
                <div 
                  className={`shimmer-box ${exp.className} h-28 mb-3 cursor-pointer`}
                />
                <p className="text-sm font-medium text-gray-800">{exp.name}</p>
                <p className="text-xs text-gray-500">{exp.description}</p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </>
  );
}
