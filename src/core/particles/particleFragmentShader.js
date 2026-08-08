// src/core/particles/particleFragmentShader.js

export const particleFragmentShader = /* glsl */`
  uniform vec3 uColor;
  
  varying float vLife;
  varying float vSize;
  varying float vSpeed;
  
  void main() {
    // Circular particle shape
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center);
    
    if (dist > 0.5) discard;
    
    // Soft edge glow
    float alpha = 1.0 - smoothstep(0.2, 0.5, dist);
    
    // Life-based fade (fade out over lifetime)
    float lifeFade = clamp(vLife * 2.0, 0.0, 1.0);
    
    // Speed-based brightness (faster = brighter)
    float speedGlow = 0.5 + 0.5 * clamp(vSpeed / 4.0, 0.0, 1.0);
    
    gl_FragColor = vec4(uColor * speedGlow, alpha * lifeFade);
  }
`;
