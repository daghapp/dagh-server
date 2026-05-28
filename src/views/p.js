
    window.onload = function() {
      // Redirect to your app after a short delay
      setTimeout(() => {
        console.log("daghapp://home")
        window.location.href = "daghapp://home";
      }, 2000); // 2 second delay
    };