// src/core/particles/particleVertexShader.js

export const particleVertexShader = /* glsl */`
  attribute float aLife;
  attribute float aSize;
  attribute vec3 aVelocity;
  
  uniform float uTime;
  
  varying float vLife;
  varying float vSize;
  varying float vSpeed;
  
  void main() {
    vLife = aLife;
    vSize = aSize;
    
    // Speed magnitude for visual feedback
    vSpeed = length(aVelocity);
    
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * 300.0 / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;
