module inv(input x, output y);
  assign y = ~x;
endmodule
module top_module(input a, output b);
  inv u0(.x(a), .y(b));
endmodule
