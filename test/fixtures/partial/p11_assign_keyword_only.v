// expect: module top_module with twelve solid ports (the header is clean); first error "assign is incomplete" at 9:7, then missing endmodule
module top_module(
  input p1a, p1b, p1c, p1d, p1e, p1f,
  output p1y,
  input p2a, p2b, p2c, p2d,
  output p2y
);

assign
