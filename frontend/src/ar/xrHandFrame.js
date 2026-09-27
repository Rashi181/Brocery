// Downsample on the GPU before readback; do not copy the full AR camera for hands.
export function createHandReader(gl) {
  const source=gl.createFramebuffer(), target=gl.createFramebuffer(), color=gl.createRenderbuffer();
  let width=0,height=0;
  return {
    read(texture,w,h) {
      const nextW=320,nextH=Math.max(1,Math.round(h*nextW/w));
      const read=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), draw=gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
      const rb=gl.getParameter(gl.RENDERBUFFER_BINDING), pbo=gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
      const scissor=gl.isEnabled(gl.SCISSOR_TEST);
      const params=[gl.PACK_ALIGNMENT,gl.PACK_ROW_LENGTH,gl.PACK_SKIP_PIXELS,gl.PACK_SKIP_ROWS];
      const saved=params.map((p)=>gl.getParameter(p));
      try {
        gl.disable(gl.SCISSOR_TEST);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER,source);
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,target);
        gl.bindRenderbuffer(gl.RENDERBUFFER,color);
        if(width!==nextW || height!==nextH) {
          width=nextW;height=nextH;gl.renderbufferStorage(gl.RENDERBUFFER,gl.RGBA8,width,height);
          gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.RENDERBUFFER,color);
        }
        gl.blitFramebuffer(0,0,w,h,0,0,width,height,gl.COLOR_BUFFER_BIT,gl.LINEAR);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER,target);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
        params.forEach((p,i)=>gl.pixelStorei(p,i===0?1:0));
        const pixels=new Uint8ClampedArray(width*height*4);
        gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        const flipped=new Uint8ClampedArray(pixels.length);
        for(let y=0;y<height;y++) flipped.set(pixels.subarray(y*width*4,(y+1)*width*4),(height-1-y)*width*4);
        return new ImageData(flipped,width,height);
      } finally {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER,source);
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,null,0);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER,read);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,draw);
        gl.bindRenderbuffer(gl.RENDERBUFFER,rb);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,pbo);
        params.forEach((p,i)=>gl.pixelStorei(p,saved[i]));
        if(scissor) gl.enable(gl.SCISSOR_TEST);
      }
    },
    dispose(){gl.deleteFramebuffer(source);gl.deleteFramebuffer(target);gl.deleteRenderbuffer(color);},
  };
}
