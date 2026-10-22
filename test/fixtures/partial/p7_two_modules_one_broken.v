// expect: modules good and top_module both found; top_module is top; good has ports x, y
module good(input x, output y);
  assign y = x;
endmodule
module top_module(input a, output b
  good u0(.x(a), .y(b));
endmodule
