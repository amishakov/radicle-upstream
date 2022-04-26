// Copyright © 2022 The Radicle Upstream Contributors
//
// This file is part of radicle-upstream, distributed under the GPLv3 with Radicle
// Linking Exception. For full terms see the included LICENSE file.

//! Crate configuration.

use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};

use futures::stream::BoxStream;

use librad::{net, net::discovery, paths, PeerId, Signer};

lazy_static::lazy_static! {
    /// Localhost binding to any available port, i.e. `127.0.0.1:0`.
    pub static ref LOCALHOST_ANY: SocketAddr =
        SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::new(127, 0, 0, 1), 0));
}

/// Configure a [`net::peer::Config`].
#[must_use]
pub fn configure<S>(paths: paths::Paths, signer: S, listen_addr: SocketAddr) -> net::peer::Config<S>
where
    S: Signer + Clone + Send + Sync + 'static,
    S::Error: std::error::Error + Send + Sync + 'static,
{
    net::peer::Config {
        signer,
        protocol: net::protocol::Config {
            paths,
            listen_addr,
            advertised_addrs: None,
            membership: net::protocol::membership::Params::default(),
            network: net::Network::default(),
            replication: net::replication::Config::default(),
            rate_limits: net::protocol::Quota::default(),
            request_pull: net::protocol::config::DenyAll,
        },
        storage: net::peer::config::Storage::default(),
    }
}

/// Discovery that never provides a boostrap peer
#[derive(Clone)]
pub struct NoDiscovery;

impl discovery::Discovery for NoDiscovery {
    type Addr = SocketAddr;
    type Stream = BoxStream<'static, (PeerId, Vec<SocketAddr>)>;

    fn discover(self) -> Self::Stream {
        Box::pin(futures::stream::pending())
    }
}
