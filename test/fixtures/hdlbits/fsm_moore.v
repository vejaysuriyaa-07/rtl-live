module top_module(input clk, input reset, input in, output out);
  localparam A = 1'b0, B = 1'b1;
  reg state, next_state;
  always @(*) begin
    case (state)
      A: next_state = in ? A : B;
      B: next_state = in ? B : A;
    endcase
  end
  always @(posedge clk) begin
    if (reset) state <= B;
    else       state <= next_state;
  end
  assign out = (state == B);
endmodule
