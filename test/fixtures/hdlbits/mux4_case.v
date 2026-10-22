// mux4_case.v: 4:1 mux from a case statement
module top_module(input [7:0] d0, d1, d2, d3, input [1:0] sel, output reg [7:0] y);
  always @(*)
    case (sel)
      2'd0: y = d0;
      2'd1: y = d1;
      2'd2: y = d2;
      default: y = d3;
    endcase
endmodule
