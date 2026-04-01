FROM nginx:alpine

# Copy all static frontend files into nginx's web root
COPY frontend/ /usr/share/nginx/html/

# Override the default nginx site config with ours
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
