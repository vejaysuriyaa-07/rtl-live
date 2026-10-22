// counter8_reset.v: 8-bit counter with synchronous reset
module top_module(input clk, reset, output reg [7:0] q);
  always @(posedge clk)
    if (reset) q <= 8'd0;
    else       q <= q + 8'd1;
endmodule
