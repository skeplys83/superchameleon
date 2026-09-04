// Ground metres walked. Advances only when grounded and not clinging — the
// same condition that plays a footstep — so anything driven off it stays in
// step with the sound. Monotonic; readers hold their own previous value.
let walked = 0;

export const addWalked = (metres: number) => {
  walked += metres;
};

export const walkedDistance = () => walked;
