//! Bits sync prototype core: a Loro-replicated library, durable local storage, and
//! peer-to-peer sync between paired devices over iroh (LAN discovery via mDNS).

pub mod model;
mod node;
pub mod proto;
pub mod rpc;
pub mod store;

pub use iroh::EndpointId;
pub use model::{Note, NotePatch};
pub use node::{DeviceStatus, Event, Invite, Node, NodeConfig, PairResult, Status};
